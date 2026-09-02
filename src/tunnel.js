const { spawn } = require('child_process');
const configManager = require('./config');
const { applyCloudflareIngressOverride } = require('./cloudflare-config.cjs');
const { locateBinary } = require('./tunnel-locate');

function originHost(host) {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
}

class TunnelManager {
  constructor(mode = 'cloudflare-named', host = '127.0.0.1', port = 3000) {
    // Keep compatibility with the old new TunnelManager(port) call shape.
    if (typeof mode === 'number') {
      port = mode;
      mode = 'cloudflare-named';
    }
    this.mode = mode;
    this.host = host;
    this.port = port;
    this.process = null;
    this.publicUrl = null;
    this.onUrlReady = null;
    this.onExit = null;
    this.onLog = null;
    this.isRunning = false;
  }

  start() {
    return new Promise((resolve, reject) => {
      const mode = this.mode;
      const providerConfig = configManager.getEffectiveConfig(mode);
      const localHost = originHost(this.host);
      let cmd = 'cloudflared';
      let args = [];
      const env = { ...process.env };

      if (mode === 'cloudflare-named') {
        const resolvedBin = locateBinary('cloudflared');
        if (!resolvedBin) {
          this.isRunning = false;
          const errMsg = 'cloudflared executable not found in PATH or standard directories (/opt/homebrew/bin, /usr/local/bin).';
          console.error(errMsg);
          if (this.onLog) this.onLog('error', errMsg);
          return reject(new Error(errMsg));
        }
        cmd = resolvedBin;

        const customConfig = providerConfig.cfConfigPath;
        let selectedHostname = '';
        try {
          selectedHostname = new URL(providerConfig.mcpUrl).hostname;
        } catch {}

        if (customConfig && selectedHostname && selectedHostname !== 'mcp.yourdomain.com') {
          const override = applyCloudflareIngressOverride(
            customConfig,
            selectedHostname,
            localHost,
            providerConfig.listenPort
          );
          if (override.error || override.reason) {
            console.warn(`Cloudflare ingress override skipped: ${override.error || override.reason}`);
          } else if (override.changed) {
            console.log(`Cloudflare ingress updated for ${selectedHostname}: ${override.originService}`);
          }
        }

        console.log(`Starting Cloudflare Named Tunnel (${cmd}, config: ${customConfig || 'default'})...`);
        args = ['tunnel'];
        if (customConfig && customConfig.trim()) args.push('--config', customConfig.trim());
        args.push('run');
      } else if (mode === 'cloudflare-quick') {
        const resolvedBin = locateBinary('cloudflared');
        if (!resolvedBin) {
          this.isRunning = false;
          const errMsg = 'cloudflared executable not found in PATH or standard directories (/opt/homebrew/bin, /usr/local/bin).';
          console.error(errMsg);
          if (this.onLog) this.onLog('error', errMsg);
          return reject(new Error(errMsg));
        }
        cmd = resolvedBin;
        console.log(`Starting Cloudflare quick tunnel (${cmd}) to ${localHost}:${this.port}...`);
        args = ['tunnel', '--url', `http://${localHost}:${this.port}`];
      } else if (mode === 'openai') {
        const resolvedBin = locateBinary('tunnel-client', providerConfig.binaryPath);
        if (!resolvedBin) {
          this.isRunning = false;
          const errMsg = 'tunnel-client executable not found. Please install openai/tunnel-client or configure its binary path.';
          console.error(errMsg);
          if (this.onLog) this.onLog('error', errMsg);
          return reject(new Error(errMsg));
        }
        cmd = resolvedBin;

        const targetUrl = `http://${localHost}:${this.port}${providerConfig.mcpPath}`;
        args = [
          'run',
          '--mcp.server-url', `url=${targetUrl}`,
          '--health.listen-addr', '127.0.0.1:0',
          '--log.format', 'struct-text',
          '--log.level', 'info'
        ];

        if (providerConfig.tunnelId) {
          args.push('--control-plane.tunnel-id', providerConfig.tunnelId.trim());
        }
        if (providerConfig.tunnelApiKey) {
          const key = providerConfig.tunnelApiKey.trim();
          env.CONTROL_PLANE_API_KEY = key;
          env.OPENAI_API_KEY = key;
        }
        console.log(`Starting OpenAI Secure MCP Tunnel client (${cmd}) pointing to ${targetUrl}...`);
      } else {
        this.isRunning = false;
        return resolve();
      }

      try {
        this.process = spawn(cmd, args, { env, detached: false });
        this.isRunning = true;
      } catch (err) {
        this.isRunning = false;
        this.process = null;
        return reject(err);
      }

      const handleOutput = (data) => {
        const output = data.toString();
        const trimmed = output.trim();
        const isDebug = configManager.get('debugMode') === true;

        if (trimmed) {
          const isErr = trimmed.includes('ERR') || trimmed.includes('error') || trimmed.includes('failed');
          const isWrn = trimmed.includes('WRN') || trimmed.includes('warn');
          const isKeyStatus = trimmed.includes('Registered tunnel') || trimmed.includes('Connected') || trimmed.includes('Route') || trimmed.includes('INF');
          const level = isErr ? 'error' : isWrn ? 'warn' : (isDebug ? 'info' : 'debug');

          if (this.onLog && (isDebug || isErr || isWrn || isKeyStatus)) {
            this.onLog(level, trimmed);
          }

          if (isDebug) {
            console.log(`[${cmd}] ${trimmed}`);
          } else if (isErr || isWrn) {
            console.warn(`[${cmd}] ${trimmed}`);
          }
        }

        if (mode === 'cloudflare-quick') {
          const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
          if (match && !this.publicUrl) {
            this.publicUrl = match[0];
            configManager.saveProviderConfig(mode, { mcpUrl: this.publicUrl });
            if (this.onUrlReady) this.onUrlReady(this.publicUrl);
            resolve(this.publicUrl);
          }
        } else if (mode === 'openai') {
          if (!this.publicUrl) {
            this.publicUrl = 'openai-secure-tunnel://managed';
            const displayUrl = 'OpenAI Secure Tunnel (Authentication: None in ChatGPT)';
            configManager.saveProviderConfig(mode, { mcpUrl: displayUrl });
            if (this.onUrlReady) this.onUrlReady(displayUrl);
            resolve(this.publicUrl);
          }
        } else if (!this.publicUrl) {
          this.publicUrl = 'system-configured';
          resolve();
        }
      };

      if (this.process.stdout) this.process.stdout.on('data', handleOutput);
      this.process.stderr.on('data', handleOutput);
      this.process.on('close', (code) => {
        console.log(`${cmd} exited with code ${code}`);
        this.publicUrl = null;
        this.isRunning = false;
        this.process = null;
        if (this.onExit) this.onExit(code);
      });
      this.process.on('error', (err) => {
        console.error(`Failed to start ${cmd}:`, err);
        this.publicUrl = null;
        this.isRunning = false;
        this.process = null;
        reject(err);
      });
    });
  }

  stop() {
    this.isRunning = false;
    this.publicUrl = null;
    if (!this.process) return;
    const proc = this.process;
    this.process = null;
    try {
      proc.kill('SIGTERM');
      setTimeout(() => {
        try {
          if (!proc.killed) proc.kill('SIGKILL');
        } catch (err) {
          console.error('Error force killing process:', err);
        }
      }, 800);
    } catch (err) {
      console.error('Error stopping tunnel process:', err);
    }
  }
}

module.exports = TunnelManager;
