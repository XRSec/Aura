const { accessSync, constants, existsSync, statSync } = require('fs');
const os = require('os');
const path = require('path');

function isExecutableFile(candidate) {
  try {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) return false;
    if (process.platform !== 'win32') accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function tunnelExecutableNames(baseName, platform = process.platform) {
  const isWin = platform === 'win32';
  const ext = isWin ? '.exe' : '';
  if (baseName === 'tunnel-client') {
    return isWin
      ? ['tunnel-client.exe', 'mcp-tunnel.exe', 'openai-tunnel.exe']
      : ['tunnel-client', 'mcp-tunnel', 'openai-tunnel'];
  }
  return [`${baseName}${ext}`];
}

function pathEntries(env = process.env) {
  const raw = env.PATH || env.Path || '';
  return raw.split(path.delimiter).map(p => p.trim()).filter(Boolean);
}

function commonBinaryDirs(platform = process.platform, env = process.env) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const isWin = platform === 'win32';
  const platformPath = isWin ? path.win32 : path.posix;

  if (isWin) {
    const localAppData = env.LOCALAPPDATA || '';
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    return [
      localAppData && platformPath.join(localAppData, 'Programs', 'tunnel-client'),
      localAppData && platformPath.join(localAppData, 'tunnel-client'),
      home && platformPath.join(home, '.tunnel-client'),
      home && platformPath.join(home, 'bin'),
      home && platformPath.join(home, 'go', 'bin'),
      home && platformPath.join(home, 'Downloads', 'tunnel-client'),
      platformPath.join(programFiles, 'tunnel-client'),
      platformPath.join(programFiles, 'cloudflared')
    ].filter(Boolean);
  }

  const homeDirs = home
    ? [
        platformPath.join(home, '.tunnel-client'),
        platformPath.join(home, '.local', 'bin'),
        platformPath.join(home, 'bin'),
        platformPath.join(home, 'go', 'bin'),
        platformPath.join(home, '.cargo', 'bin'),
        platformPath.join(home, 'Downloads', 'tunnel-client')
      ]
    : [];

  const systemDirs = platform === 'darwin'
    ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
    : ['/home/linuxbrew/.linuxbrew/bin', '/usr/local/bin', '/usr/bin', '/snap/bin'];

  return [...homeDirs, ...systemDirs];
}

function discoverBinaries(baseName = 'tunnel-client') {
  const names = tunnelExecutableNames(baseName);
  const found = new Set();
  const dirs = [...pathEntries(), ...commonBinaryDirs()];

  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    for (const name of names) {
      const fullPath = path.join(dir.replace(/^"|"$/g, ''), name);
      if (isExecutableFile(fullPath)) {
        found.add(fullPath);
      }
    }
  }

  return Array.from(found);
}

function locateBinary(baseName = 'tunnel-client', hint = '') {
  const names = tunnelExecutableNames(baseName);

  if (hint && typeof hint === 'string' && hint.trim()) {
    const trimmed = hint.trim();
    if (existsSync(trimmed)) {
      if (isExecutableFile(trimmed)) {
        return trimmed;
      }
      for (const name of names) {
        const asDir = path.join(trimmed, name);
        if (isExecutableFile(asDir)) {
          return asDir;
        }
      }
    }
  }

  const detected = discoverBinaries(baseName);
  return detected.length > 0 ? detected[0] : null;
}

module.exports = {
  isExecutableFile,
  discoverBinaries,
  locateBinary
};
