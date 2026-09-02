const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const PROVIDERS = ['cloudflare-named', 'cloudflare-quick', 'openai', 'custom'];
const DEFAULT_PROVIDER = 'cloudflare-named';
const SHELL_POLICIES = ['unrestricted', 'allowlist', 'denylist'];
const DEFAULT_SHELL_POLICY = 'unrestricted';

function normalizeShellPolicy(stored) {
  if (stored && typeof stored.shellPolicy === 'string' && SHELL_POLICIES.includes(stored.shellPolicy)) {
    return stored.shellPolicy;
  }
  if (Array.isArray(stored?.shellAllowlist) && stored.shellAllowlist.length > 0) {
    return 'allowlist';
  }
  if (Array.isArray(stored?.shellDenylist) && stored.shellDenylist.length > 0) {
    return 'denylist';
  }
  return DEFAULT_SHELL_POLICY;
}

function normalizePort(value, fallback = 3000) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

function normalizeHost(value, fallback = '127.0.0.1') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeMcpPath(value) {
  return typeof value === 'string' && /^\/[A-Za-z0-9_-]{40,}\/mcp$/.test(value)
    ? value
    : createMcpPath();
}

function createMcpPath() {
  return `/${crypto.randomBytes(32).toString('base64url')}/mcp`;
}

function providerDefaults(mode) {
  const defaults = {
    mcpUrl: mode === 'openai'
      ? 'OpenAI Secure Tunnel (Auth: None)'
      : 'https://mcp.yourdomain.com',
    mcpPath: createMcpPath(),
    cfConfigPath: '',
    listenHost: '127.0.0.1',
    listenPort: 3000,
    tunnelId: '',
    tunnelApiKey: '',
    binaryPath: '',
    sslCertPath: '',
    sslKeyPath: ''
  };
  return defaults;
}

class ConfigManager {
  constructor() {
    const userDataPath = (app && typeof app.getPath === 'function')
      ? app.getPath('userData')
      : path.join(os.homedir(), '.aura');
    if (!fs.existsSync(userDataPath)) {
      try { fs.mkdirSync(userDataPath, { recursive: true }); } catch {}
    }
    this.configPath = path.join(userDataPath, 'aura-config.json');
    this.defaultConfig = {
      tunnelMode: DEFAULT_PROVIDER,
      autoConnect: true,
      debugMode: false,
      fsRoot: '~/',
      shellPolicy: DEFAULT_SHELL_POLICY,
      shellAllowlist: [],
      shellDenylist: [],
      tokenValidity: '24h',
      providerConfigs: Object.fromEntries(PROVIDERS.map(mode => [mode, providerDefaults(mode)]))
    };
    this.config = this.loadConfig();
  }

  loadConfig() {
    let stored = {};
    try {
      if (fs.existsSync(this.configPath)) {
        stored = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    }

    const providerConfigs = Object.fromEntries(PROVIDERS.map(mode => [
      mode,
      {
        ...providerDefaults(mode),
        ...(stored.providerConfigs?.[mode] || {})
      }
    ]));

    let needsSave = !fs.existsSync(this.configPath);
    PROVIDERS.forEach(mode => {
      const currentVal = stored.providerConfigs?.[mode]?.mcpPath;
      const normalized = normalizeMcpPath(currentVal);
      providerConfigs[mode].mcpPath = normalized;
      if (currentVal !== normalized) {
        needsSave = true;
      }
    });

    const shellPolicy = normalizeShellPolicy(stored);
    if (stored.shellPolicy !== shellPolicy) {
      needsSave = true;
    }

    const finalConfig = {
      ...this.defaultConfig,
      ...stored,
      shellPolicy,
      providerConfigs,
      fsRoot: stored.fsRoot ?? '~/'
    };

    if (needsSave) {
      try {
        fs.writeFileSync(this.configPath, JSON.stringify(finalConfig, null, 2));
      } catch (err) {
        console.error('Failed to auto-save normalized config:', err);
      }
    }

    return finalConfig;
  }

  write() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      return true;
    } catch (err) {
      console.error('[ConfigManager] Failed to save config:', err);
      return false;
    }
  }

  saveConfig(newConfig) {
    const globalConfig = { ...newConfig };
    delete globalConfig.providerConfigs;
    delete globalConfig.mcpUrl;
    delete globalConfig.cfConfigPath;
    delete globalConfig.listenHost;
    delete globalConfig.listenPort;
    delete globalConfig.tunnelId;
    delete globalConfig.tunnelApiKey;
    delete globalConfig.binaryPath;
    delete globalConfig.sslCertPath;
    delete globalConfig.sslKeyPath;
    if (globalConfig.shellPolicy && !SHELL_POLICIES.includes(globalConfig.shellPolicy)) {
      delete globalConfig.shellPolicy;
    }
    this.config = { ...this.config, ...globalConfig };
    return this.write();
  }

  getProviderConfig(mode = this.config.tunnelMode) {
    const provider = PROVIDERS.includes(mode) ? mode : DEFAULT_PROVIDER;
    const current = this.config.providerConfigs?.[provider] || {};
    return {
      ...providerDefaults(provider),
      ...current,
      mcpPath: normalizeMcpPath(current.mcpPath),
      listenHost: normalizeHost(current.listenHost),
      listenPort: normalizePort(current.listenPort),
      tunnelId: typeof current.tunnelId === 'string' ? current.tunnelId.trim() : '',
      tunnelApiKey: typeof current.tunnelApiKey === 'string' ? current.tunnelApiKey.trim() : '',
      binaryPath: typeof current.binaryPath === 'string' ? current.binaryPath.trim() : '',
      sslCertPath: typeof current.sslCertPath === 'string' ? current.sslCertPath.trim() : '',
      sslKeyPath: typeof current.sslKeyPath === 'string' ? current.sslKeyPath.trim() : ''
    };
  }

  getEffectiveConfig(mode = this.config.tunnelMode) {
    return {
      ...this.config,
      tunnelMode: mode,
      ...this.getProviderConfig(mode),
      providerConfigs: this.config.providerConfigs
    };
  }

  saveNetworkConfig(mode, payload = {}) {
    const targetMode = PROVIDERS.includes(mode)
      ? mode
      : (PROVIDERS.includes(payload.tunnelMode) ? payload.tunnelMode : DEFAULT_PROVIDER);

    this.config.tunnelMode = targetMode;

    const current = this.getProviderConfig(targetMode);
    const providerUpdates = {};

    if (payload.listenHost !== undefined) {
      providerUpdates.listenHost = normalizeHost(payload.listenHost);
    }
    if (payload.listenPort !== undefined) {
      providerUpdates.listenPort = normalizePort(payload.listenPort);
    }

    if (targetMode === 'cloudflare-named' || targetMode === 'custom') {
      if (typeof payload.cfConfigPath === 'string') {
        providerUpdates.cfConfigPath = payload.cfConfigPath.trim();
      }
      if (typeof payload.mcpUrl === 'string') {
        providerUpdates.mcpUrl = payload.mcpUrl.trim() || 'https://mcp.yourdomain.com';
      }
      if (typeof payload.sslCertPath === 'string') {
        providerUpdates.sslCertPath = payload.sslCertPath.trim();
      }
      if (typeof payload.sslKeyPath === 'string') {
        providerUpdates.sslKeyPath = payload.sslKeyPath.trim();
      }
    } else if (targetMode === 'openai') {
      if (typeof payload.tunnelId === 'string') {
        providerUpdates.tunnelId = payload.tunnelId.trim();
      }
      if (typeof payload.tunnelApiKey === 'string') {
        providerUpdates.tunnelApiKey = payload.tunnelApiKey.trim();
      }
      if (typeof payload.binaryPath === 'string') {
        providerUpdates.binaryPath = payload.binaryPath.trim();
      }
      providerUpdates.mcpUrl = 'OpenAI Secure Tunnel (Auth: None)';
    }

    this.config.providerConfigs[targetMode] = {
      ...current,
      ...providerUpdates
    };

    if (typeof payload.autoConnect === 'boolean') {
      this.config.autoConnect = payload.autoConnect;
    }
    if (typeof payload.debugMode === 'boolean') {
      this.config.debugMode = payload.debugMode;
    }
    if (typeof payload.fsRoot === 'string') {
      this.config.fsRoot = payload.fsRoot;
    }
    if (typeof payload.shellPolicy === 'string' && SHELL_POLICIES.includes(payload.shellPolicy)) {
      this.config.shellPolicy = payload.shellPolicy;
    }

    this.write();
    return this.getEffectiveConfig(targetMode);
  }

  saveProviderConfig(mode, updates = {}) {
    const provider = PROVIDERS.includes(mode) ? mode : DEFAULT_PROVIDER;
    const current = this.getProviderConfig(provider);
    const cleanedUpdates = { ...updates };

    // Prevent cross-provider placeholder pollution
    if ((provider === 'cloudflare-named' || provider === 'custom') && typeof cleanedUpdates.mcpUrl === 'string') {
      if (cleanedUpdates.mcpUrl.includes('OpenAI Secure Tunnel')) {
        delete cleanedUpdates.mcpUrl;
      }
    }

    const next = {
      ...current,
      ...cleanedUpdates,
      listenHost: normalizeHost(cleanedUpdates.listenHost ?? current.listenHost),
      listenPort: normalizePort(cleanedUpdates.listenPort ?? current.listenPort)
    };
    this.config.providerConfigs[provider] = next;
    return this.write();
  }

  get(key) {
    return this.config[key];
  }

  set(key, value) {
    this.config[key] = value;
    return this.write();
  }
}

module.exports = new ConfigManager();
