const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { app, safeStorage } = require('electron');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');
const { AsyncLocalStorage } = require('async_hooks');
const configManager = require('./config');
const { validateSslFiles } = require('./acme-locate');

const CHATGPT_CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
const CHATGPT_CALLBACK_PREFIX = 'https://chatgpt.com/connector/oauth/';

function safeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function validRedirectUri(value) {
  return value === CHATGPT_CALLBACK || value.startsWith(CHATGPT_CALLBACK_PREFIX);
}

function verifyPkce(verifier, challenge) {
  if (!verifier || !challenge) return false;
  const digest = crypto.createHash('sha256').update(verifier).digest('base64url');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(challenge));
}

class AuthGateway extends EventEmitter {
  constructor(host = '127.0.0.1', port = 3000, mcpPath = '/mcp', sslConfig = null) {
    super();
    this.app = express();
    this.host = host;
    this.port = port;
    this.mcpPath = mcpPath;
    this.sslConfig = sslConfig;
    this.isHttps = false;
    this.authCodes = new Map();
    this.tokens = new Map();
    this.clients = new Map();
    const userDataPath = (app && typeof app.getPath === 'function')
      ? app.getPath('userData')
      : path.join(os.homedir(), '.aura');
    if (!fs.existsSync(userDataPath)) {
      try { fs.mkdirSync(userDataPath, { recursive: true }); } catch {}
    }
    this.storagePath = path.join(userDataPath, 'aura-tokens.json');
    this.httpContext = new AsyncLocalStorage();
    this.onLog = null;
    this.loadState();
    this.setupRoutes();
  }

  loadState() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.tokens)) {
          this.tokens = new Map(data.tokens);
        }
        if (Array.isArray(data.clients)) {
          this.clients = new Map(data.clients);
        }
      }
    } catch (err) {
      console.error('Failed to load auth tokens:', err);
    }
  }

  saveState() {
    try {
      const data = {
        tokens: Array.from(this.tokens.entries()),
        clients: Array.from(this.clients.entries())
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save auth tokens:', err);
    }
  }

  verifyPassword(inputPassword) {
    const storedSecretBase64 = configManager.get('adminSecret');
    if (!storedSecretBase64) return true; // If no password set, allow
    try {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const decrypted = safeStorage.decryptString(Buffer.from(storedSecretBase64, 'base64'));
        return decrypted === inputPassword;
      }
    } catch (e) {
      console.error('Failed to decrypt adminSecret:', e);
    }
    return false;
  }

  resourceUrl() {
    const configured = configManager.getEffectiveConfig().mcpUrl;
    const base = String(configured || '').replace(/\/+$/, '');
    return base.endsWith(this.mcpPath) ? base : `${base}${this.mcpPath}`;
  }

  authorizationMetadata() {
    const issuer = this.resourceUrl();
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['mcp'],
      client_id_metadata_document_supported: true
    };
  }

  protectedResourceMetadata() {
    const resource = this.resourceUrl();
    return {
      resource,
      authorization_servers: [resource],
      scopes_supported: ['mcp'],
      bearer_methods_supported: ['header']
    };
  }

  renderAuthHtml({ clientId, redirectUri, challenge, state, errorMsg = '' }) {
    const errorHtml = errorMsg ? `<div class="error-banner">${safeText(errorMsg)}</div>` : '';
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize Aura MCP</title>
  <style>
    :root {
      --bg: #0d0d0f;
      --card-bg: rgba(24, 24, 27, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --text-main: #f4f4f5;
      --text-muted: #a1a1aa;
      --text-dim: #71717a;
      --accent: #339cff;
      --accent-hover: #1f8bff;
      --accent-glow: rgba(51, 156, 255, 0.25);
      --error-bg: rgba(239, 68, 68, 0.12);
      --error-border: rgba(239, 68, 68, 0.28);
      --error-text: #fca5a5;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      -webkit-font-smoothing: antialiased;
    }
    .auth-card {
      width: 100%;
      max-width: 410px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 32px 28px;
      box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.03);
      
      
    }
    @keyframes enter {
      from { opacity: 0; transform: scale(0.96) translateY(6px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .brand-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 22px;
      padding-bottom: 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .brand-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: #339cff;
      font-weight: 700;
      font-size: 17px;
      color: #fff;
      
    }
    .brand-title {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .brand-subtitle {
      font-size: 11px;
      color: var(--text-dim);
      letter-spacing: 0.04em;
    }
    .auth-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
      letter-spacing: -0.015em;
    }
    .auth-desc {
      font-size: 13px;
      line-height: 1.55;
      color: var(--text-muted);
      margin-bottom: 22px;
    }
    .client-tag {
      color: #fff;
      font-weight: 600;
      background: rgba(255, 255, 255, 0.08);
      padding: 2px 7px;
      border-radius: 5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
    }
    .error-banner {
      background: var(--error-bg);
      border: 1px solid var(--error-border);
      color: var(--error-text);
      font-size: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      margin-bottom: 18px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .field-group {
      margin-bottom: 22px;
    }
    .field-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .input-field {
      width: 100%;
      height: 42px;
      padding: 0 14px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--card-border);
      border-radius: 9px;
      color: var(--text-main);
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: all 0.15s ease;
    }
    .input-field:focus {
      border-color: var(--accent);
      background: rgba(255, 255, 255, 0.07);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }
    .btn-approve {
      width: 100%;
      height: 42px;
      background: var(--accent);
      border: none;
      border-radius: 9px;
      color: #ffffff;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 4px 14px rgba(51, 156, 255, 0.28);
    }
    .btn-approve:hover {
      background: var(--accent-hover);
      transform: translateY(-1px);
    }
    .btn-approve:active {
      transform: translateY(0);
    }
    .footer-security {
      margin-top: 22px;
      text-align: center;
      font-size: 11px;
      color: var(--text-dim);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }
  </style>
</head>
<body>
  <div class="auth-card">
    <div class="brand-header">
      <div class="brand-badge">A</div>
      <div>
        <div class="brand-title">Aura MCP</div>
        <div class="brand-subtitle">Local Connector Gateway</div>
      </div>
    </div>

    <h1 class="auth-title">Authorize Access</h1>
    <p class="auth-desc">Client <span class="client-tag">${safeText(clientId || 'ChatGPT')}</span> is requesting access to execute MCP tools on this computer.</p>

    ${errorHtml}

    <form method="post">
      <input type="hidden" name="client_id" value="${safeText(clientId)}">
      <input type="hidden" name="redirect_uri" value="${safeText(redirectUri)}">
      <input type="hidden" name="code_challenge" value="${safeText(challenge)}">
      <input type="hidden" name="code_challenge_method" value="S256">
      <input type="hidden" name="state" value="${safeText(state)}">

      <div class="field-group">
        <label class="field-label" for="password">Admin Password</label>
        <input class="input-field" id="password" name="password" type="password" placeholder="••••••••" required autofocus autocomplete="current-password">
      </div>

      <button type="submit" class="btn-approve">Approve Access</button>
    </form>

    <div class="footer-security">
      🔒 Protected by Aura OAuth 2.1 & PKCE
    </div>
  </div>
</body>
</html>`;
  }

  setupRoutes() {
    this.app.use(cors({ origin: true, credentials: false }));
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // HTTP Inbound Request Context Binder
    this.app.use((req, res, next) => {
      const started = Date.now();
      const requestId = uuidv4();
      req.requestId = requestId;
      const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
      const ip = (typeof rawIp === 'string' ? rawIp.split(',')[0].trim() : '').replace(/^.*:/, '') || '127.0.0.1';

      const authHeader = req.headers.authorization;
      const authSummary = authHeader ? String(authHeader) : 'None';

      const store = {
        requestId,
        method: req.method,
        url: req.url,
        ip,
        auth: authSummary,
        userAgent: req.headers['user-agent'] || '',
        headers: req.headers,
        query: req.query,
        started,
        hasToolCall: false
      };

      res.on('finish', () => {
        const duration = Date.now() - started;
        const status = res.statusCode;
        const isDebug = configManager.get('debugMode') === true;
        const statusEmoji = status < 400 ? '🌐' : (status < 500 ? '⚠️' : '❌');

        if (isDebug) {
          console.log(`${statusEmoji} [HTTP] ${req.method} ${req.url} -> ${status} (${duration}ms, IP: ${ip})`);
        } else if (status >= 400) {
          console.warn(`${statusEmoji} [HTTP ${status}] ${req.method} ${req.url} (${duration}ms, IP: ${ip})`);
        }

        // Handle pure HTTP requests (non-MCP tool calls like OAuth, metadata, or health probes)
        if (!store.hasToolCall) {
          const isError = status >= 400;
          const isKeyAuth = req.url.includes('/oauth/authorize') || req.url.includes('/oauth/token') || req.url.includes('/oauth/register');

          // In non-debug mode: only record errors or key OAuth requests, suppress high-frequency probes
          // In debug mode: record every inbound HTTP request with full detailed headers & metadata
          if (isDebug || isError || isKeyAuth) {
            const httpMeta = {
              method: req.method,
              url: req.url,
              status,
              ip,
              auth: authSummary,
              requestId
            };

            if (isDebug) {
              httpMeta.headers = req.headers;
              httpMeta.userAgent = req.headers['user-agent'] || '';
              if (req.query && Object.keys(req.query).length > 0) {
                httpMeta.query = req.query;
              }
            }

            this.emit('http-request-log', {
              timestamp: new Date().toISOString(),
              tool: null,
              params: null,
              result: isError ? "Error" : "Success",
              output: null,
              error: isError ? `HTTP ${status}` : null,
              duration,
              http: httpMeta
            });
          }
        }
      });

      this.httpContext.run(store, () => next());
    });

    const protectedMetadata = (_req, res) => res.json(this.protectedResourceMetadata());
    const authorizationMetadata = (_req, res) => res.json(this.authorizationMetadata());
    this.app.get(`/.well-known/oauth-protected-resource${this.mcpPath}`, protectedMetadata);
    this.app.get(`/.well-known/oauth-authorization-server${this.mcpPath}`, authorizationMetadata);
    this.app.get(`${this.mcpPath}/.well-known/oauth-protected-resource`, protectedMetadata);
    this.app.get(`${this.mcpPath}/.well-known/oauth-authorization-server`, authorizationMetadata);
    this.app.get(`/.well-known/oauth-protected-resource`, protectedMetadata);
    this.app.get(`/.well-known/oauth-authorization-server`, authorizationMetadata);
    this.app.get(`${this.mcpPath}/.well-known/openid-configuration`, authorizationMetadata);
    this.app.get(`/.well-known/openid-configuration`, authorizationMetadata);

    const register = (req, res) => {
      const body = req.body || {};
      const redirects = body.redirect_uris;
      if (!Array.isArray(redirects) || !redirects.length || !redirects.every(validRedirectUri)) {
        return res.status(400).json({ error: 'invalid_redirect_uri' });
      }
      if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none') {
        return res.status(400).json({ error: 'invalid_client_metadata' });
      }
      const clientId = crypto.randomBytes(16).toString('hex');
      this.clients.set(clientId, {
        client_id: clientId,
        client_name: typeof body.client_name === 'string' ? body.client_name : 'ChatGPT',
        redirect_uris: redirects
      });
      this.saveState();
      return res.status(201).json({
        client_id: clientId,
        client_name: this.clients.get(clientId).client_name,
        redirect_uris: redirects,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code']
      });
    };
    this.app.post(`${this.mcpPath}/oauth/register`, register);

    const authorize = (req, res) => {
      const values = req.method === 'GET' ? req.query : req.body;
      const clientId = String(values.client_id || '');
      const redirectUri = String(values.redirect_uri || '');
      const challenge = String(values.code_challenge || '');
      const method = String(values.code_challenge_method || '');
      if (!validRedirectUri(redirectUri) || method !== 'S256' || !challenge || String(values.response_type || 'code') !== 'code') {
        return res.status(400).send('Invalid OAuth request. Reconnect from ChatGPT to create a fresh authorization request.');
      }
      if (req.method === 'GET') {
        return res.send(this.renderAuthHtml({
          clientId,
          redirectUri,
          challenge,
          state: values.state
        }));
      }
      if (!values.password) {
        return res.status(401).send(this.renderAuthHtml({
          clientId,
          redirectUri,
          challenge,
          state: values.state,
          errorMsg: 'Password is required to authorize this connection.'
        }));
      }
      if (!this.verifyPassword(values.password)) {
        return res.status(401).send(this.renderAuthHtml({
          clientId,
          redirectUri,
          challenge,
          state: values.state,
          errorMsg: 'Incorrect Admin Password. Please try again.'
        }));
      }
      const code = uuidv4();
      this.authCodes.set(code, {
        clientId,
        redirectUri,
        codeChallenge: challenge,
        expiresAt: Date.now() + 5 * 60 * 1000
      });
      try {
        const redirect = new URL(redirectUri);
        redirect.searchParams.set('code', code);
        if (values.state) redirect.searchParams.set('state', String(values.state));
        const finalRedirectUrl = redirect.toString();
        if (finalRedirectUrl.startsWith('https://chatgpt.com/')) {
          return res.redirect(finalRedirectUrl);
        }
        return res.status(400).send('Invalid redirect destination.');
      } catch {
        return res.status(400).send('Invalid redirect URI structure.');
      }
    };
    this.app.get(`${this.mcpPath}/oauth/authorize`, authorize);
    this.app.post(`${this.mcpPath}/oauth/authorize`, authorize);

    const token = (req, res) => {
      const body = req.body || {};
      if (body.grant_type === 'refresh_token') {
        const refresh = String(body.refresh_token || '');
        const entry = this.tokens.get(refresh);
        if (!entry || entry.type !== 'refresh') return res.status(400).json({ error: 'invalid_grant' });
        return res.json(this.issueTokens(entry.clientId));
      }
      if (body.grant_type !== 'authorization_code') return res.status(400).json({ error: 'unsupported_grant_type' });
      const stored = this.authCodes.get(String(body.code || ''));
      if (!stored || stored.expiresAt <= Date.now() || stored.clientId !== body.client_id || stored.redirectUri !== body.redirect_uri || !verifyPkce(body.code_verifier, stored.codeChallenge)) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      this.authCodes.delete(String(body.code));
      return res.json(this.issueTokens(stored.clientId));
    };
    this.app.post(`${this.mcpPath}/oauth/token`, token);
  }

  issueTokens(clientId) {
    const accessToken = `mcp_at_${crypto.randomBytes(32).toString('base64url')}`;
    const refreshToken = `mcp_rt_${crypto.randomBytes(32).toString('base64url')}`;
    this.tokens.set(accessToken, { type: 'access', clientId, expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 });
    this.tokens.set(refreshToken, { type: 'refresh', clientId });
    this.saveState();
    return { access_token: accessToken, token_type: 'Bearer', expires_in: 365 * 24 * 60 * 60, refresh_token: refreshToken };
  }

  isAccessTokenValid(token) {
    const entry = this.tokens.get(token);
    return !!entry && entry.type === 'access' && entry.expiresAt > Date.now();
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        let server;
        if (this.sslConfig && this.sslConfig.certPath && this.sslConfig.keyPath) {
          const validation = validateSslFiles(this.sslConfig.certPath, this.sslConfig.keyPath);
          if (!validation.valid) {
            throw new Error(`SSL configuration error: ${validation.error}`);
          }
          const httpsOptions = {
            cert: validation.certContent,
            key: validation.keyContent
          };
          server = https.createServer(httpsOptions, this.app);
          this.isHttps = true;
        } else {
          server = http.createServer(this.app);
          this.isHttps = false;
        }

        this.server = server.listen(this.port, this.host, () => {
          const proto = this.isHttps ? 'https' : 'http';
          console.log(`Auth Gateway running on ${proto}://${this.host}:${this.port}${this.mcpPath}`);
          resolve({ port: this.port, protocol: proto, isHttps: this.isHttps });
        });
        this.server.once('error', reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  getActiveTokens() {
    return Array.from(this.tokens.entries())
      .filter(([, data]) => data.type === 'access')
      .map(([token, data]) => ({ token, client_id: data.clientId, issuedAt: data.expiresAt - 365 * 24 * 60 * 60 * 1000 }));
  }

  revokeToken(token) {
    const deleted = this.tokens.delete(token);
    if (deleted) this.saveState();
    return deleted;
  }

  stop() {
    return new Promise(resolve => {
      if (!this.server) return resolve();
      this.server.close(() => {
        this.server = null;
        resolve();
      });
      this.server.closeAllConnections?.();
    });
  }
}

module.exports = AuthGateway;
