const { app, BrowserWindow, ipcMain, safeStorage, Tray, Menu, shell, dialog } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const configManager = require('./config');
const AuthGateway = require('./auth');
const McpGateway = require('./mcp');
const { PiBridge } = require('./pi-bridge');
const TunnelManager = require('./tunnel');
const { inspectCloudflareConfig, discoverCloudflareConfigs } = require('./cloudflare-config.cjs');
const { discoverBinaries } = require('./tunnel-locate');
const { discoverAcmeCertificates, validateSslFiles } = require('./acme-locate');
const packageMetadata = require('../package.json');

let authServer;
let mcpGateway;
let tunnelManager;
let mainWindow;
let tray;
let isConnected = false;

// Runtime state: keep one-click lifecycle, but expose internal service health.
const runtimeState = {
  status: 'stopped',
  mode: null,
  mcp: { status: 'stopped', endpoint: null },
  auth: { status: 'stopped' },
  tunnel: { status: 'stopped', mode: null, publicUrl: null }
};

function emitRuntimeState() {
  try {
    emitLog('runtime-state-changed', JSON.parse(JSON.stringify(runtimeState)));
  } catch (err) {
    console.error('Failed to emit runtime state:', err);
  }
}

const recentAppRuntimeLogs = [];
const recentTunnelLogs = [];
const recentMcpLogs = [];

function loadAndPruneOldLogs() {
  try {
    const userDataPath = (app && typeof app.getPath === 'function')
      ? app.getPath('userData')
      : path.join(os.homedir(), '.aura');
    const logsPath = path.join(userDataPath, 'aura-logs.json');
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days retention

    if (fs.existsSync(logsPath)) {
      const raw = fs.readFileSync(logsPath, 'utf8');
      const data = JSON.parse(raw);

      const prune = (arr) => Array.isArray(arr)
        ? arr.filter(item => {
            const t = item.timestamp ? new Date(item.timestamp).getTime() : 0;
            return t >= cutoff;
          }).slice(-500)
        : [];

      if (Array.isArray(data.mcpLogs)) recentMcpLogs.push(...prune(data.mcpLogs));
      if (Array.isArray(data.tunnelLogs)) recentTunnelLogs.push(...prune(data.tunnelLogs));
      if (Array.isArray(data.appRuntimeLogs)) recentAppRuntimeLogs.push(...prune(data.appRuntimeLogs));
    }
  } catch (err) {
    console.error('Failed to load/prune aura logs:', err);
  }
}

function savePersistedLogs() {
  try {
    const userDataPath = (app && typeof app.getPath === 'function')
      ? app.getPath('userData')
      : path.join(os.homedir(), '.aura');
    const logsPath = path.join(userDataPath, 'aura-logs.json');
    const data = {
      savedAt: new Date().toISOString(),
      mcpLogs: recentMcpLogs.slice(-500),
      tunnelLogs: recentTunnelLogs.slice(-500),
      appRuntimeLogs: recentAppRuntimeLogs.slice(-500)
    };
    fs.writeFileSync(logsPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save logs to disk:', err);
  }
}

function emitLog(channel, logData) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, logData);
  }
}

function logAppRuntime(level, message, detail = null) {
  const isDebug = configManager.get('debugMode') === true;
  if (level === 'debug' && !isDebug) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level, // 'info' | 'warn' | 'error' | 'debug'
    source: 'App',
    message,
    detail
  };

  recentAppRuntimeLogs.push(entry);
  if (recentAppRuntimeLogs.length > 500) recentAppRuntimeLogs.shift();
  emitLog('runtime-log', entry);
}

function logTunnel(level, message, detail = null) {
  const isDebug = configManager.get('debugMode') === true;
  if (level === 'debug' && !isDebug) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    source: 'Tunnel',
    message,
    detail
  };

  recentTunnelLogs.push(entry);
  if (recentTunnelLogs.length > 500) recentTunnelLogs.shift();
  emitLog('tunnel-log', entry);
}

async function startServices() {
  if (isConnected) return;

  const mode = configManager.get('tunnelMode');
  const providerConfig = configManager.getEffectiveConfig(mode);
  runtimeState.status = 'starting';
  runtimeState.mode = mode;
  runtimeState.mcp = { status: 'starting', endpoint: null };
  runtimeState.auth = { status: 'starting' };
  runtimeState.tunnel = { status: 'starting', mode, publicUrl: null };
  emitRuntimeState();

  logAppRuntime('info', `Initializing local services with tunnel mode: ${mode}...`);

  if (!authServer) {
    let sslConfig = null;
    if (mode === 'custom' && providerConfig.sslCertPath && providerConfig.sslKeyPath) {
      sslConfig = {
        certPath: providerConfig.sslCertPath,
        keyPath: providerConfig.sslKeyPath
      };
    }

    authServer = new AuthGateway(providerConfig.listenHost, providerConfig.listenPort, providerConfig.mcpPath, sslConfig);
    authServer.on('http-request-log', (logEntry) => {
      recentMcpLogs.push(logEntry);
      if (recentMcpLogs.length > 500) recentMcpLogs.shift();
      emitLog('mcp-log', logEntry);
    });
    try {
      await authServer.start();
      const proto = authServer.isHttps ? 'https' : 'http';
      runtimeState.auth = { status: 'ready', protocol: proto };
      emitRuntimeState();
      logAppRuntime('info', `Auth Gateway listening on ${proto}://${providerConfig.listenHost}:${providerConfig.listenPort}${providerConfig.mcpPath}${authServer.isHttps ? ' (SSL active)' : ''}`);
    } catch (err) {
      logAppRuntime('error', `Auth Gateway startup error: ${err.message}`);
      console.error('Auth Gateway error:', err);
      if (sslConfig) {
        logAppRuntime('warn', 'Retrying Auth Gateway startup in plain HTTP mode...');
        authServer = new AuthGateway(providerConfig.listenHost, providerConfig.listenPort, providerConfig.mcpPath, null);
        authServer.on('http-request-log', (logEntry) => {
          recentMcpLogs.push(logEntry);
          if (recentMcpLogs.length > 500) recentMcpLogs.shift();
          emitLog('mcp-log', logEntry);
        });
        await authServer.start();
        logAppRuntime('info', `Auth Gateway listening on http://${providerConfig.listenHost}:${providerConfig.listenPort}${providerConfig.mcpPath}`);
      }
    }

    mcpGateway = new McpGateway(authServer);

    mcpGateway.on('execution-log', (logEntry) => {
      recentMcpLogs.push(logEntry);
      if (recentMcpLogs.length > 500) recentMcpLogs.shift();
      emitLog('mcp-log', logEntry);
    });

    runtimeState.mcp = {
      status: 'ready',
      endpoint: `${providerConfig.listenHost}:${providerConfig.listenPort}${providerConfig.mcpPath}`
    };
    emitRuntimeState();
    logAppRuntime('info', `MCP Gateway ready with core tools at ${providerConfig.mcpPath}`);
  }

  if (mode === 'cloudflare-quick' || mode === 'cloudflare-named' || mode === 'openai') {
    logTunnel('info', `Starting ${mode} tunnel process on port ${providerConfig.listenPort}...`);
    tunnelManager = new TunnelManager(mode, providerConfig.listenHost, providerConfig.listenPort);
    tunnelManager.onLog = (level, message) => {
      logTunnel(level, message);
    };
    tunnelManager.onUrlReady = (url) => {
      runtimeState.tunnel = { status: 'connected', mode, publicUrl: url };
      emitRuntimeState();
      logTunnel('info', `Public endpoint active: ${url}`);
      emitLog('url-updated', url);
    };
    await tunnelManager.start().catch(err => {
      logTunnel('error', `Tunnel startup error: ${err.message}`);
      console.error('Tunnel error:', err);
    });
  }

  runtimeState.status = 'running';
  emitRuntimeState();
  isConnected = true;
  emitLog('service-state-changed', true);
  logAppRuntime('info', `All local MCP services running on port ${providerConfig.listenPort}. Ready for AI requests.`);
}

async function restartServices() {
  logAppRuntime('info', 'Restarting MCP and Tunnel services...');
  await stopServices();
  await startServices();
}

async function stopServices() {
  if (tunnelManager) {
    tunnelManager.stop();
    tunnelManager = null;
    logTunnel('info', 'Tunnel process stopped.');
  }
  if (mcpGateway) {
    await mcpGateway.close();
    mcpGateway = null;
  }
  if (authServer) {
    await authServer.stop();
    authServer = null;
  }

  runtimeState.status = 'stopped';
  runtimeState.mcp.status = 'stopped';
  runtimeState.auth.status = 'stopped';
  runtimeState.tunnel.status = 'stopped';
  emitRuntimeState();
  isConnected = false;
  emitLog('service-state-changed', false);
  logAppRuntime('info', 'Local MCP services stopped.');
}

function closeMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

function setupApplicationMenu() {
  if (process.platform !== 'darwin') return;

  const githubUrl = packageMetadata.homepage || 'https://github.com/XRSec/Aura';
  app.setAboutPanelOptions({
    applicationName: app.getName(),
    applicationVersion: app.getVersion(),
    website: githubUrl,
    websiteLabel: 'GitHub'
  });

  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { label: `About ${app.name}`, click: () => app.showAboutPanel() },
        { type: 'separator' },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+W',
          click: closeMainWindow
        },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${app.name}` }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'forceReload', label: 'Force Reload' },
        { role: 'toggleDevTools', label: 'Toggle Developer Tools' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Full Screen' }
      ]
    }
  ]);

  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 760,
    minWidth: 760,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Console forwarding (for debugging):
  // mainWindow.webContents.on('console-message', (_event, _level, message, line) => {
  //   console.log(`[Renderer L${line}] ${message}`);
  // });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  loadAndPruneOldLogs();
  setupApplicationMenu();
  createWindow();

  logAppRuntime('info', 'Aura application initialized.');

  const autoConnect = configManager.get('autoConnect') !== false;
  if (autoConnect) {
    await startServices();
  } else {
    logAppRuntime('info', 'Auto-connect disabled. Click Connect to start MCP services.');
  }

  // Create System Tray
  const { nativeImage } = require('electron');
  const trayIconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const trayIcon = fs.existsSync(trayIconPath) 
    ? nativeImage.createFromPath(trayIconPath)
    : nativeImage.createEmpty();
  tray = new Tray(trayIcon); 
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Aura',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    {
      label: 'Reload',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Close Window',
      click: closeMainWindow
    },
    { label: 'Quit', click: () => { app.quit(); } }
  ]);
  tray.setToolTip('Aura MCP Connector');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    } else {
      createWindow();
    }
  });

  app.on('activate', function () {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  savePersistedLogs();
  if (tunnelManager) {
    tunnelManager.stop();
    tunnelManager = null;
  }
  if (authServer) {
    authServer.stop();
    authServer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers for secret storage and config
ipcMain.handle('get-config', (_event, mode) => {
  return configManager.getEffectiveConfig(mode || configManager.get('tunnelMode'));
});

ipcMain.handle('get-pi-capabilities', async () => {
  const bridge = new PiBridge({
    getFsRoot: () => configManager.get('fsRoot') || '~/'
  });
  try {
    await bridge.initialize();
    if (!bridge.available) {
      return { available: false, version: null, tools: [], error: bridge.initError?.message || 'Pi is unavailable.' };
    }
    return {
      available: true,
      version: bridge.version,
      tools: bridge.listTools().map(tool => ({
        name: tool.name,
        description: tool.description || '',
        category: tool.category,
        usesPiDefaultModel: tool.usesPiDefaultModel === true,
        sourceInfo: tool.sourceInfo ? {
          source: tool.sourceInfo.source || '',
          path: tool.sourceInfo.path || '',
          scope: tool.sourceInfo.scope || '',
          origin: tool.sourceInfo.origin || ''
        } : null
      })),
      error: null
    };
  } finally {
    bridge.dispose();
  }
});

ipcMain.handle('pick-cf-config', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Cloudflare Config File',
    properties: ['openFile'],
    filters: [{ name: 'YAML Config', extensions: ['yml', 'yaml', 'json'] }]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const chosenPath = result.filePaths[0];
    configManager.saveProviderConfig(configManager.get('tunnelMode'), { cfConfigPath: chosenPath });
    const inspected = inspectCloudflareConfig(chosenPath);
    if (inspected && inspected.error) {
      return { path: chosenPath, error: inspected.error, hostnames: [] };
    }
    return { path: chosenPath, ...inspected };
  }
  return null;
});

ipcMain.handle('get-cf-hostnames', (_event, customPath) => {
  return inspectCloudflareConfig(customPath);
});

ipcMain.handle('discover-cf-configs', () => {
  return discoverCloudflareConfigs();
});

ipcMain.handle('get-listen-addresses', () => {
  const addresses = [
    { name: 'Loopback only', address: '127.0.0.1', family: 'IPv4', internal: true },
    { name: 'All network interfaces', address: '0.0.0.0', family: 'IPv4', internal: false }
  ];
  const seen = new Set(addresses.map(item => item.address));
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || seen.has(entry.address)) continue;
      seen.add(entry.address);
      addresses.push({ name, address: entry.address, family: entry.family, internal: entry.internal });
    }
  }
  return addresses;
});

ipcMain.handle('save-config', async (_event, newConfig) => {
  const mode = newConfig?.tunnelMode || configManager.get('tunnelMode');
  const result = configManager.saveNetworkConfig(mode, newConfig || {});
  logAppRuntime('info', `Configuration saved for mode: ${mode}`, {
    tunnelMode: result.tunnelMode,
    mcpUrl: result.mcpUrl,
    listenPort: result.listenPort,
    cfConfigPath: result.cfConfigPath
  });
  return result;
});

ipcMain.handle('pick-binary-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select tunnel-client Binary',
    properties: ['openFile'],
    filters: [
      { name: 'Executables', extensions: process.platform === 'win32' ? ['exe', 'bat', 'cmd'] : ['*'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('discover-tunnel-binaries', () => {
  return discoverBinaries('tunnel-client');
});

ipcMain.handle('discover-acme-certs', () => {
  return discoverAcmeCertificates();
});

ipcMain.handle('pick-cert-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select SSL Certificate File',
    properties: ['openFile'],
    filters: [
      { name: 'Certificates (*.cer, *.crt, *.pem)', extensions: ['cer', 'crt', 'pem'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('pick-key-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select SSL Private Key File',
    properties: ['openFile'],
    filters: [
      { name: 'Private Keys (*.key, *.pem)', extensions: ['key', 'pem'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('validate-ssl-files', (_event, certPath, keyPath) => {
  return validateSslFiles(certPath, keyPath);
});

ipcMain.handle('save-provider-config', (_event, mode, updates) => {
  return configManager.saveProviderConfig(mode, updates || {});
});

ipcMain.handle('get-tokens', () => {
  return authServer ? authServer.getActiveTokens() : [];
});

ipcMain.handle('get-recent-logs', () => {
  return {
    appRuntimeLogs: recentAppRuntimeLogs,
    tunnelLogs: recentTunnelLogs,
    mcpLogs: recentMcpLogs
  };
});

ipcMain.handle('clear-recent-logs', () => {
  recentMcpLogs.length = 0;
  recentTunnelLogs.length = 0;
  recentAppRuntimeLogs.length = 0;
  savePersistedLogs();
  return { ok: true };
});

ipcMain.handle('revoke-token', (_event, token) => {
  return authServer ? authServer.revokeToken(token) : false;
});

ipcMain.handle('get-service-state', () => {
  return isConnected;
});

ipcMain.handle('toggle-service-state', async (_event, connect) => {
  if (connect) {
    await startServices();
  } else {
    await stopServices();
  }
  return isConnected;
});

ipcMain.handle('restart-tunnel', async (_event, mode) => {
  if (!isConnected) return false;
  if (mode && typeof mode === 'string') {
    configManager.saveConfig({ tunnelMode: mode });
  }
  await restartServices();
  return true;
});

ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('save-secret', (_event, secret) => {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(secret);
    configManager.set('adminSecret', encrypted.toString('base64'));
    return true;
  }
  return false;
});
