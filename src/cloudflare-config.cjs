const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parse, stringify } = require("yaml");

const MAX_CONFIG_BYTES = 1024 * 1024;
const EXACT_HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function defaultCloudflareConfigPath() {
  return path.join(os.homedir(), ".cloudflared", "config.yml");
}

function discoverCloudflareConfigs() {
  const dotFolder = path.join(os.homedir(), ".cloudflared");
  const etcFolder = process.platform === "win32" ? "C:\\ProgramData\\cloudflared" : "/etc/cloudflared";
  const candidates = [
    defaultCloudflareConfigPath(),
    path.join(dotFolder, "config.yaml"),
    path.join(etcFolder, "config.yml"),
    path.join(etcFolder, "config.yaml")
  ];

  if (fs.existsSync(dotFolder)) {
    try {
      const files = fs.readdirSync(dotFolder);
      for (const file of files) {
        if ((file.endsWith('.yml') || file.endsWith('.yaml')) && !candidates.includes(path.join(dotFolder, file))) {
          candidates.push(path.join(dotFolder, file));
        }
      }
    } catch {}
  }

  return candidates.filter(p => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function inspectCloudflareConfig(configPath = "") {
  let resolved = configPath;
  if (!resolved) {
    resolved = defaultCloudflareConfigPath();
  } else if (resolved.startsWith('~/')) {
    resolved = path.join(os.homedir(), resolved.slice(2));
  }
  resolved = path.resolve(resolved);

  try {
    const info = fs.statSync(resolved);
    if (!info.isFile()) throw new Error("Cloudflare config is not a file.");
    if (info.size > MAX_CONFIG_BYTES) throw new Error("Cloudflare config is larger than 1 MiB.");
    const value = parse(fs.readFileSync(resolved, "utf8"));
    if (!record(value)) throw new Error("Cloudflare config must contain a YAML object.");
    if (typeof value.tunnel !== "string" || !value.tunnel.trim()) {
      throw new Error("Cloudflare config has no tunnel id or name.");
    }
    if (!Array.isArray(value.ingress) || !value.ingress.every(record)) {
      throw new Error("Cloudflare config has no valid ingress rules.");
    }
    const hostnames = [];
    const seen = new Set();
    for (const rule of value.ingress) {
      if (rule.path !== undefined || typeof rule.hostname !== "string") continue;
      const hostname = rule.hostname.trim().toLowerCase();
      if (!EXACT_HOSTNAME.test(hostname) || seen.has(hostname)) continue;
      seen.add(hostname);
      hostnames.push(hostname);
    }
    return {
      path: resolved,
      exists: true,
      hostnames,
      error: hostnames.length ? null : "Cloudflare config has no exact hostname ingress rule without a path.",
    };
  } catch (error) {
    const missing = error?.code === "ENOENT" || error?.code === "EACCES";
    return {
      path: resolved,
      exists: !missing,
      hostnames: [],
      error: !configPath && missing
        ? null
        : missing
          ? "The selected Cloudflare config cannot be read."
          : error instanceof Error ? error.message : String(error),
    };
  }
}

function applyCloudflareIngressOverride(configPath = "", hostname = "", originHost = "127.0.0.1", port = 3000) {
  let resolved = configPath;
  if (!resolved) resolved = defaultCloudflareConfigPath();
  else if (resolved.startsWith('~/')) resolved = path.join(os.homedir(), resolved.slice(2));
  resolved = path.resolve(resolved);

  const targetHostname = String(hostname || '').trim().toLowerCase();
  if (!targetHostname) return { changed: false, reason: 'No selected hostname.' };

  try {
    const source = fs.readFileSync(resolved, 'utf8');
    const value = parse(source);
    if (!record(value) || !Array.isArray(value.ingress)) {
      return { changed: false, reason: 'Cloudflare config has no valid ingress rules.' };
    }

    const rule = value.ingress.find(candidate => (
      record(candidate) &&
      typeof candidate.hostname === 'string' &&
      candidate.hostname.trim().toLowerCase() === targetHostname
    ));
    if (!rule) return { changed: false, reason: `No ingress rule found for ${targetHostname}.` };

    const safeOriginHost = originHost === '0.0.0.0' || originHost === '::' ? '127.0.0.1' : originHost;
    const originService = `http://${safeOriginHost}:${port}`;
    if (rule.service === originService && (!('originService' in rule) || rule.originService === originService)) {
      return { changed: false, path: resolved, originService };
    }

    const backupPath = `${resolved}.aura-backup`;
    if (!fs.existsSync(backupPath)) fs.copyFileSync(resolved, backupPath);
    rule.service = originService;
    if ('originService' in rule) rule.originService = originService;

    const tempPath = `${resolved}.aura-tmp-${process.pid}`;
    fs.writeFileSync(tempPath, stringify(value), 'utf8');
    fs.renameSync(tempPath, resolved);
    return { changed: true, path: resolved, backupPath, originService };
  } catch (error) {
    return { changed: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function locateCloudflared(configuredPath = "") {
  const executable = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const candidates = [
    configuredPath,
    ...String(process.env.PATH || process.env.Path || "")
      .split(path.delimiter)
      .filter(Boolean)
      .map(directory => path.join(directory.replace(/^"|"$/g, ""), executable)),
    ...(process.platform === "darwin"
      ? ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"]
      : process.platform === "linux"
        ? ["/usr/local/bin/cloudflared", "/usr/bin/cloudflared"]
        : []),
  ];
  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate)) continue;
    try {
      fs.accessSync(candidate, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return "";
}

module.exports = {
  defaultCloudflareConfigPath,
  discoverCloudflareConfigs,
  inspectCloudflareConfig,
  applyCloudflareIngressOverride,
  locateCloudflared
};
