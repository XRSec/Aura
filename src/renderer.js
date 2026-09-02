const modeLabels = {
  'cloudflare-named': 'Cloudflare Named Tunnel',
  'cloudflare-quick': 'Cloudflare Quick Tunnel',
  'openai': 'OpenAI Secure MCP Tunnel',
  'custom': 'Custom / Bring Your Own Tunnel'
};

const shellPolicyLabels = {
  'unrestricted': 'Unrestricted',
  'allowlist': 'Allowlist only',
  'denylist': 'Denylist enforced'
};

const ZH_TRANSLATIONS = {
  'Settings': '设置',
  'Logs': '日志',
  'Stopped': '已停止',
  'Running': '运行中',
  'Connect': '连接',
  'Disconnect': '断开连接',
  'Connector Configuration': '连接器配置',
  'Configure local tools, network tunnels, and authorization credentials for AI assistants.': '配置 AI 助手使用的本地工具、网络隧道和授权凭据。',
  'General': '常规',
  'Auto Connect': '自动连接',
  'Automatically start server & tunnel on app launch': '应用启动时自动启动服务器和隧道',
  'Debug Mode': '调试模式',
  'Enable verbose logging and diagnostic protocol output': '启用详细日志和诊断协议输出',
  'Language': '语言',
  'Appearance': '外观',
  'Dark': '深色',
  'Light': '浅色',
  'Network & Tunnel': '网络与隧道',
  'Tunnel Mode': '隧道模式',
  'Recommended': '推荐',
  'Random URL': '随机 URL',
  'Private Ingress': '私有入口',
  'BYO Proxy': '自定义代理',
  'MCP Listen Address': 'MCP 监听地址',
  'MCP Listen Port': 'MCP 监听端口',
  'Tunnel Binary': '隧道程序',
  'Binary File Path': '二进制文件路径',
  'Auto detect': '自动检测',
  'Auto detect (recommended)': '自动检测（推荐）',
  'Detected': '已检测',
  'Common path': '常见路径',
  'Browse…': '浏览…',
  'Tunnel ID': '隧道 ID',
  'Tunnel API Key': '隧道 API Key',
  'Show': '显示',
  'Hide': '隐藏',
  'Config File': '配置文件',
  'SSL Certificate': 'SSL 证书',
  'SSL Private Key': 'SSL 私钥',
  'MCP Endpoint URL': 'MCP 端点 URL',
  'Tunnel Setup': '隧道设置',
  'Requires Cloudflare config in Named/Quick tunnel mode.': 'Named/Quick 隧道模式需要 Cloudflare 配置。',
  'Open setup docs': '打开设置文档',
  'Save': '保存',
  'Saved ✓': '已保存 ✓',
  'Debug mode enabled (verbose logging)': '调试模式已启用（详细日志）',
  'Debug mode disabled': '调试模式已关闭',
  'No active tokens': '暂无活跃令牌',
  'Tokens will appear here after an MCP client completes authorization.': 'MCP 客户端完成授权后，令牌会显示在这里。',
  'Active': '有效',
  'Issued': '签发于',
  'Revoke': '撤销',
  'Revoking': '正在撤销',
  'Token revoked': '令牌已撤销',
  'Failed to revoke token': '撤销令牌失败',
  'Connection Guide': '连接指南',
  'Access & Authorization': '访问与授权',
  'Admin Password': '管理员密码',
  'Set once, used for all OAuth approval screens.': '设置一次，用于所有 OAuth 授权页面。',
  'Legacy Electron password must be reset': '旧版 Electron 管理密码需要重新设置',
  'Reset required — enter a new password': '需要重置——请输入新的管理密码',
  'Active Connections': '活跃连接',
  'OpenAI Secure Ingress Managed': 'OpenAI 安全入口已托管',
  'No active connections.': '暂无活跃连接。',
  'Refresh Tokens': '刷新令牌',
  'MCP Instructions & Capabilities': 'MCP 指令与能力',
  'MCP Instructions': 'MCP 指令',
  'Reset': '重置',
  'Automatically sent to the MCP client during session initialization. Reset uses the standard Aura prompt for the current Pi and language settings.': '会话初始化时自动发送给 MCP 客户端。重置会使用当前 Pi 与语言设置对应的 Aura 标准提示词。',
  'Use Aura Core Capabilities': '使用 Aura 核心能力',
  "Expose Aura's built-in MCP tools such as read_file, write_file, and execute_shell.": '暴露 Aura 内置 MCP 工具，例如 read_file、write_file 和 execute_shell。',
  'Loading default tools...': '正在加载默认工具…',
  'Loading default Aura capabilities...': '正在加载 Aura 默认能力…',
  'Use Pi Capabilities': '使用 Pi 能力',
  'Selected Pi tools are exposed and enabled immediately for each MCP connection. Disabled by default.': '选中的 Pi 工具会在每个 MCP 连接中立即暴露并启用。默认关闭。',
  'Loading Pi tools...': '正在加载 Pi 工具…',
  'Select visible': '选择当前可见',
  'Clear visible': '清除当前可见',
  'All plugins': '全部插件',
  'Enable Pi capabilities to load the available tool registry.': '启用 Pi 能力以加载可用工具注册表。',
  'Local Tool Sandbox': '本地工具沙箱',
  'Filesystem Root': '文件系统根目录',
  'Shell Policy': 'Shell 策略',
  'Unrestricted': '不限制',
  'Allow all': '全部允许',
  'Allowlist only': '仅允许列表',
  'Strict allowlist': '严格允许列表',
  'Denylist enforced': '强制拒绝列表',
  'Block denylist': '阻止拒绝列表',
  'Shell Allowlist': 'Shell 允许列表',
  'Shell Denylist': 'Shell 拒绝列表',
  'Status: Unrestricted (All commands allowed)': '状态：不限制（允许所有命令）',
  'Status: Allowlist only (Only allowed commands permitted)': '状态：仅允许列表（只允许白名单命令）',
  'Status: Denylist enforced (Blocked commands will be rejected)': '状态：已启用拒绝列表（命中的命令将被拒绝）',
  'Activity & Diagnostic Logs': '活动与诊断日志',
  'Monitor real-time MCP tool invocations, protocol payloads, and system tunnel diagnostics.': '监控实时 MCP 工具调用、协议载荷和系统隧道诊断。',
  'MCP Requests': 'MCP 请求',
  'Tunnel': '隧道',
  'App Runtime': '应用运行时',
  'Copy': '复制',
  'Clear': '清除',
  'Recent MCP Requests': '最近 MCP 请求',
  'Waiting for AI assistant MCP requests...': '等待 AI 助手的 MCP 请求…',
  'Tunnel Process & Diagnostics': '隧道进程与诊断',
  'Waiting for tunnel events...': '等待隧道事件…',
  'App Runtime & Lifecycle': '应用运行时与生命周期',
  'Waiting for app runtime events...': '等待应用运行时事件…'
};

let currentLanguage = 'en';
let currentAppearance = 'dark';
let currentServiceRunning = false;

function t(text) {
  return currentLanguage === 'zh-CN' ? (ZH_TRANSLATIONS[text] || text) : text;
}

function localizeStaticText(language) {
  if (!document.body) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  nodes.forEach(node => {
    const parent = node.parentElement;
    if (!parent || parent.closest('script, style')) return;
    const trimmed = node.nodeValue.trim();
    if (!node.__auraEnglishText && ZH_TRANSLATIONS[trimmed]) {
      node.__auraEnglishText = trimmed;
      node.__auraPrefix = node.nodeValue.match(/^\s*/)?.[0] || '';
      node.__auraSuffix = node.nodeValue.match(/\s*$/)?.[0] || '';
    }
    if (!node.__auraEnglishText) return;
    const translated = language === 'zh-CN'
      ? (ZH_TRANSLATIONS[node.__auraEnglishText] || node.__auraEnglishText)
      : node.__auraEnglishText;
    node.nodeValue = `${node.__auraPrefix}${translated}${node.__auraSuffix}`;
  });
}

function applyAppearance(appearance) {
  currentAppearance = appearance === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = currentAppearance;
  const display = document.getElementById('appearance-display');
  if (display) {
    display.value = t(currentAppearance === 'light' ? 'Light' : 'Dark');
    display.dataset.value = currentAppearance;
  }
}

function applyLanguage(language) {
  currentLanguage = language === 'zh-CN' ? 'zh-CN' : 'en';
  document.documentElement.lang = currentLanguage;
  localizeStaticText(currentLanguage);

  const languageDisplay = document.getElementById('language-display');
  if (languageDisplay) {
    languageDisplay.value = currentLanguage === 'zh-CN' ? '中文' : 'English';
    languageDisplay.dataset.value = currentLanguage;
  }
  applyAppearance(currentAppearance);

  const tunnelDisplay = document.getElementById('tunnel-mode-display');
  const tunnelMode = tunnelDisplay?.dataset.value || tunnelDisplay?.getAttribute('data-value');
  if (tunnelDisplay && tunnelMode) tunnelDisplay.value = t(modeLabels[tunnelMode] || tunnelMode);

  const shellPolicyDisplay = document.getElementById('shell-policy-display');
  const shellPolicy = shellPolicyDisplay?.dataset.value || shellPolicyDisplay?.getAttribute('data-value');
  if (shellPolicyDisplay && shellPolicy) shellPolicyDisplay.value = t(shellPolicyLabels[shellPolicy] || shellPolicy);

  updateServiceUI(currentServiceRunning);
  if (shellPolicy) updateShellStatus(shellPolicy);
  updateDefaultToolsSummary();
  updatePiToolsSummary();
  if (piCapabilitiesLoaded) populatePiToolPluginFilter();
}

// Listen to Real-time Logs via IPC immediately at top level
const mcpLogs = [];
const tunnelLogs = [];
const runtimeLogs = [];
const MAX_DOM_LOG_ITEMS = 150;
let currentMainTab = 'settings';
let pendingLogsRender = { mcp: false, tunnel: false, runtime: false };

let piCapabilityTools = [];
let piCapabilitiesLoaded = false;
let piCapabilitiesLoadPromise = null;
let savedMcpInstructions = '';
let defaultCapabilityTools = [];
let savedDefaultCapabilitiesEnabled = true;
let savedDefaultToolNames = new Set();
let savedPiEnabled = false;
let savedPiToolNames = new Set();
let mcpInstructionDefaults = { basic: '', pi: '' };

function debounce(fn, waitMs) {
  let timeoutId = null;
  return function (...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn.apply(this, args);
    }, waitMs);
  };
}

function rafThrottle(fn) {
  let rafId = null;
  return function (...args) {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      fn.apply(this, args);
    }, 0);
  };
}

function flushPendingLogs() {
  if (pendingLogsRender.mcp) {
    renderRecentMcpLogs();
    pendingLogsRender.mcp = false;
  }
  if (pendingLogsRender.tunnel) {
    renderRecentTunnelLogs();
    pendingLogsRender.tunnel = false;
  }
  if (pendingLogsRender.runtime) {
    renderRecentRuntimeLogs();
    pendingLogsRender.runtime = false;
  }
}

window.api.onMcpLog((logEntry) => {
  mcpLogs.push(logEntry);
  if (mcpLogs.length > 500) mcpLogs.shift();
  if (currentMainTab === 'logs') {
    renderMcpLogItem(logEntry);
  } else {
    pendingLogsRender.mcp = true;
  }
});

window.api.onTunnelLog((logEntry) => {
  tunnelLogs.push(logEntry);
  if (tunnelLogs.length > 1000) tunnelLogs.shift();
  if (currentMainTab === 'logs') {
    renderTunnelLogItem(logEntry);
  } else {
    pendingLogsRender.tunnel = true;
  }
});

window.api.onRuntimeLog((logEntry) => {
  runtimeLogs.push(logEntry);
  if (runtimeLogs.length > 1000) runtimeLogs.shift();
  if (currentMainTab === 'logs') {
    renderRuntimeLogItem(logEntry);
  } else {
    pendingLogsRender.runtime = true;
  }
});

function switchMainTab(targetTab) {
  currentMainTab = targetTab;
  const tabBtnSettings = document.getElementById('tab-btn-settings');
  const tabBtnLogs = document.getElementById('tab-btn-logs');
  const surfaceSettings = document.getElementById('surface-settings');
  const surfaceLogs = document.getElementById('surface-logs');

  if (targetTab === 'settings') {
    if (tabBtnSettings) {
      tabBtnSettings.classList.add('is-active');
      tabBtnSettings.setAttribute('aria-selected', 'true');
    }
    if (tabBtnLogs) {
      tabBtnLogs.classList.remove('is-active');
      tabBtnLogs.setAttribute('aria-selected', 'false');
    }
    if (surfaceSettings) {
      surfaceSettings.classList.add('is-active');
      surfaceSettings.style.display = 'block';
    }
    if (surfaceLogs) {
      surfaceLogs.classList.remove('is-active');
      surfaceLogs.style.display = 'none';
    }
  } else if (targetTab === 'logs') {
    if (tabBtnLogs) {
      tabBtnLogs.classList.add('is-active');
      tabBtnLogs.setAttribute('aria-selected', 'true');
    }
    if (tabBtnSettings) {
      tabBtnSettings.classList.remove('is-active');
      tabBtnSettings.setAttribute('aria-selected', 'false');
    }
    if (surfaceLogs) {
      surfaceLogs.classList.add('is-active');
      surfaceLogs.style.display = 'flex';
    }
    if (surfaceSettings) {
      surfaceSettings.classList.remove('is-active');
      surfaceSettings.style.display = 'none';
    }
    flushPendingLogs();
  }
}

function switchLogSubtab(targetSubtab) {
  const subtabMcp = document.getElementById('log-subtab-mcp');
  const subtabTunnel = document.getElementById('log-subtab-tunnel');
  const subtabRuntime = document.getElementById('log-subtab-runtime');
  const mcpLogView = document.getElementById('mcp-log-view');
  const tunnelLogView = document.getElementById('tunnel-log-view');
  const runtimeLogView = document.getElementById('runtime-log-view');

  [subtabMcp, subtabTunnel, subtabRuntime].filter(Boolean).forEach(btn => btn.classList.remove('is-active'));
  if (mcpLogView) mcpLogView.style.display = 'none';
  if (tunnelLogView) tunnelLogView.style.display = 'none';
  if (runtimeLogView) runtimeLogView.style.display = 'none';

  if (targetSubtab === 'mcp') {
    if (subtabMcp) subtabMcp.classList.add('is-active');
    if (mcpLogView) mcpLogView.style.display = 'flex';
  } else if (targetSubtab === 'tunnel') {
    if (subtabTunnel) subtabTunnel.classList.add('is-active');
    if (tunnelLogView) tunnelLogView.style.display = 'flex';
  } else if (targetSubtab === 'runtime') {
    if (subtabRuntime) subtabRuntime.classList.add('is-active');
    if (runtimeLogView) runtimeLogView.style.display = 'flex';
  }
}

window.switchMainTab = switchMainTab;
window.switchLogSubtab = switchLogSubtab;

function filterLogs(keyword) {
  const q = String(keyword || '').trim().toLowerCase();
  document.querySelectorAll('.activity-item, .tunnel-log-item, .runtime-log-item').forEach(item => {
    item.style.display = !q || item.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}


function getCurrentMode() {
  return document.getElementById('tunnel-mode-display')?.getAttribute('data-value') || 'cloudflare-named';
}

async function restartCurrentServices(mode = getCurrentMode()) {
  try {
    await window.api.restartTunnel(mode);
  } catch (err) {
    console.error('Failed to restart local MCP services:', err);
    flashTransientHint('Saved, but service restart failed', 'tunnel-install-hint');
  }
}

function focusInput(el, isActive) {
  if (!el) return;
  if (isActive) {
    el.classList.add('is-focused');
  } else {
    el.classList.remove('is-focused');
  }
}

function getSelectedDefaultToolNames() {
  return Array.from(document.querySelectorAll('#default-tools-list .default-tool-checkbox:checked'))
    .map(input => input.value)
    .sort();
}

function updateDefaultToolsSummary() {
  const summary = document.getElementById('default-tools-summary');
  if (!summary) return;
  const selected = getSelectedDefaultToolNames().length;
  const available = defaultCapabilityTools.length;
  summary.textContent = currentLanguage === 'zh-CN'
    ? `${selected} 个已选择 · ${available} 个可用`
    : `${selected} selected · ${available} available`;
}

function renderDefaultCapabilityTools(catalog = [], selected = []) {
  const list = document.getElementById('default-tools-list');
  if (!list) return;
  list.replaceChildren();
  defaultCapabilityTools = Array.isArray(catalog) ? catalog : [];
  const selectedNames = new Set(Array.isArray(selected) ? selected : []);
  const fragment = document.createDocumentFragment();
  for (const tool of defaultCapabilityTools) {
    const row = document.createElement('label');
    row.className = 'pi-tool-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'default-tool-checkbox';
    checkbox.value = tool.name;
    checkbox.checked = selectedNames.has(tool.name);
    checkbox.addEventListener('change', () => {
      updateDefaultToolsSummary();
      scheduleUpdateMcpCapabilitiesSaveState();
    });
    const body = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'pi-tool-name';
    name.textContent = tool.name;
    const description = document.createElement('div');
    description.className = 'pi-tool-description';
    description.textContent = tool.description || '';
    body.append(name, description);
    row.append(checkbox, body);
    fragment.appendChild(row);
  }
  if (!defaultCapabilityTools.length) {
    const empty = document.createElement('div');
    empty.className = 'pi-tools-empty';
    empty.textContent = 'No default capabilities available.';
    fragment.appendChild(empty);
  }
  list.appendChild(fragment);
  updateDefaultToolsSummary();
}

function getPiToolPlugin(tool) {
  const sourceInfo = tool?.sourceInfo || {};
  const source = String(sourceInfo.source || '').trim();
  const sourcePath = String(sourceInfo.path || '').trim();

  if (source === 'builtin') return 'Pi Built-in';
  if (source.startsWith('npm:')) {
    const packageName = source.slice('npm:'.length).trim();
    if (packageName) return packageName;
  }
  if (source && !['auto', 'local', 'cli'].includes(source) && !source.startsWith('git:')) {
    return source;
  }

  const normalizedPath = sourcePath.replace(/\\/g, '/');
  const nodeModulesMatch = normalizedPath.match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (nodeModulesMatch?.[1]) return nodeModulesMatch[1];

  const extensionMatch = normalizedPath.match(/\/extensions\/([^/]+)/);
  if (extensionMatch?.[1]) {
    return extensionMatch[1].replace(/\.(?:[cm]?[jt]sx?)$/i, '');
  }

  if (source.startsWith('git:')) {
    const gitSource = source.slice('git:'.length).split('#')[0].replace(/\/+$/, '');
    const gitName = gitSource.split(/[/:]/).filter(Boolean).pop()?.replace(/\.git$/i, '');
    if (gitName) return gitName;
  }

  const pathParts = normalizedPath.split('/').filter(Boolean);
  const fileName = pathParts.pop() || '';
  const fileStem = fileName.replace(/\.(?:[cm]?[jt]sx?)$/i, '');
  if (fileStem && fileStem !== 'index') return fileStem;
  if (pathParts.length) return pathParts[pathParts.length - 1];
  return source || 'Unknown source';
}

function populatePiToolPluginFilter() {
  const display = document.getElementById('pi-tools-plugin-display');
  const menu = document.getElementById('pi-tools-plugin-dropdown-menu');
  const arrow = document.getElementById('pi-tools-plugin-arrow');
  if (!display || !menu) return;

  const previous = display.dataset.value || 'all';
  const counts = new Map();
  for (const tool of piCapabilityTools) {
    const plugin = getPiToolPlugin(tool);
    counts.set(plugin, (counts.get(plugin) || 0) + 1);
  }

  const plugins = Array.from(counts.keys()).sort((a, b) => {
    if (a === 'Pi Built-in') return -1;
    if (b === 'Pi Built-in') return 1;
    return a.localeCompare(b);
  });
  const entries = [
    { value: 'all', label: t('All plugins'), count: piCapabilityTools.length },
    ...plugins.map(plugin => ({ value: plugin, label: plugin, count: counts.get(plugin) }))
  ];
  const selectedValue = entries.some(entry => entry.value === previous) ? previous : 'all';

  menu.replaceChildren();
  for (const entry of entries) {
    const option = document.createElement('div');
    option.className = 'combobox-option';
    option.setAttribute('role', 'option');
    option.setAttribute('tabindex', '-1');
    option.setAttribute('aria-selected', 'false');
    option.dataset.value = entry.value;

    const label = document.createElement('span');
    label.textContent = entry.label;
    const count = document.createElement('span');
    count.style.color = 'var(--color-text-tertiary)';
    count.style.fontSize = '10px';
    count.style.flex = 'none';
    count.textContent = `${entry.count} tool${entry.count === 1 ? '' : 's'}`;
    option.append(label, count);

    option.addEventListener('click', event => {
      event.stopPropagation();
      display.value = `${entry.label} (${entry.count})`;
      display.dataset.value = entry.value;
      if (arrow) setMenuVisibility(menu, display, arrow, false);
      filterPiTools(document.getElementById('pi-tools-search')?.value || '');
    });
    menu.appendChild(option);

    if (entry.value === selectedValue) {
      display.value = `${entry.label} (${entry.count})`;
      display.dataset.value = entry.value;
    }
  }

  if (arrow) setMenuVisibility(menu, display, arrow, false);
}

function getSelectedPiToolNames() {
  if (!piCapabilitiesLoaded) return Array.from(savedPiToolNames).sort();
  return Array.from(document.querySelectorAll('#pi-tools-list .pi-tool-checkbox:checked'))
    .map(input => input.value)
    .sort();
}

function currentMcpInstructionDefault(piEnabled = document.getElementById('pi-enabled-toggle')?.checked === true) {
  return piEnabled ? (mcpInstructionDefaults.pi || '') : (mcpInstructionDefaults.basic || '');
}

function resetMcpInstructions() {
  const instructions = document.getElementById('mcp-instructions');
  if (!instructions) return;
  instructions.value = currentMcpInstructionDefault();
  updateMcpCapabilitiesSaveState();
  instructions.focus();
}

function getVisiblePiToolCheckboxes() {
  return Array.from(document.querySelectorAll('#pi-tools-list .pi-tool-checkbox'))
    .filter(input => input.closest('.pi-tool-item')?.style.display !== 'none');
}

function updatePiToolsBulkButtons() {
  const selectButton = document.getElementById('pi-tools-select-visible-btn');
  const clearButton = document.getElementById('pi-tools-clear-visible-btn');
  if (!selectButton || !clearButton) return;
  const boxes = getVisiblePiToolCheckboxes();
  selectButton.disabled = !piCapabilitiesLoaded || boxes.length === 0 || boxes.every(input => input.checked);
  clearButton.disabled = !piCapabilitiesLoaded || boxes.length === 0 || boxes.every(input => !input.checked);
}

function setVisiblePiToolsSelected(selected) {
  const boxes = getVisiblePiToolCheckboxes();
  if (!boxes.length) return;
  boxes.forEach(input => { input.checked = selected; });
  updatePiToolsSummary();
  updateMcpCapabilitiesSaveState();
}

function filterPiTools(query = '') {
  const normalized = String(query || '').trim().toLowerCase();
  const selectedPlugin = document.getElementById('pi-tools-plugin-display')?.dataset.value || 'all';
  const rows = Array.from(document.querySelectorAll('#pi-tools-list .pi-tool-item'));
  let visible = 0;
  rows.forEach(row => {
    const matchesSearch = !normalized || String(row.dataset.searchText || '').includes(normalized);
    const matchesPlugin = selectedPlugin === 'all' || row.dataset.plugin === selectedPlugin;
    const matches = matchesSearch && matchesPlugin;
    row.style.display = matches ? '' : 'none';
    if (matches) visible += 1;
  });
  const empty = document.getElementById('pi-tools-filter-empty');
  if (empty) empty.style.display = rows.length > 0 && visible === 0 ? 'block' : 'none';
  updatePiToolsBulkButtons();
}

function updatePiToolsSummary() {
  const summary = document.getElementById('pi-tools-summary');
  if (!summary) return;
  if (!piCapabilitiesLoaded) {
    summary.textContent = t('Loading Pi tools...');
    return;
  }
  const enabled = getSelectedPiToolNames().length;
  summary.textContent = currentLanguage === 'zh-CN'
    ? `${enabled} 个已启用 · ${piCapabilityTools.length} 个可用`
    : `${enabled} enabled · ${piCapabilityTools.length} available`;
  updatePiToolsBulkButtons();
}

function updateMcpCapabilitiesSaveState() {
  const saveBtn = document.getElementById('save-mcp-capabilities-btn');
  const instructions = document.getElementById('mcp-instructions');
  const defaultToggle = document.getElementById('default-capabilities-toggle');
  const piToggle = document.getElementById('pi-enabled-toggle');
  if (!saveBtn || !instructions || !defaultToggle || !piToggle) return;
  const savedDefaultTools = Array.from(savedDefaultToolNames).sort();
  const currentDefaultTools = getSelectedDefaultToolNames();
  const savedTools = Array.from(savedPiToolNames).sort();
  const currentTools = getSelectedPiToolNames();
  const dirty = instructions.value !== savedMcpInstructions
    || defaultToggle.checked !== savedDefaultCapabilitiesEnabled
    || JSON.stringify(currentDefaultTools) !== JSON.stringify(savedDefaultTools)
    || piToggle.checked !== savedPiEnabled
    || JSON.stringify(currentTools) !== JSON.stringify(savedTools);
  saveBtn.classList.toggle('btn-primary', dirty);
}

const scheduleUpdateMcpCapabilitiesSaveState = rafThrottle(updateMcpCapabilitiesSaveState);
const scheduleUpdateNetworkSaveState = rafThrottle(updateNetworkSaveState);
const scheduleUpdateSandboxSaveState = rafThrottle(updateSandboxSaveState);
const debouncedRenderConnectionGuide = debounce(renderConnectionGuide, 60);
const debouncedFilterPiTools = debounce((query) => filterPiTools(query), 80);

function renderPiCapabilityTools(result) {
  const list = document.getElementById('pi-tools-list');
  const version = document.getElementById('pi-version-label');
  if (!list) return;
  list.replaceChildren();
  piCapabilityTools = Array.isArray(result?.tools) ? result.tools : [];
  piCapabilitiesLoaded = true;
  if (version) version.textContent = result?.available && result?.version ? `Pi ${result.version}` : '';
  populatePiToolPluginFilter();

  if (!result?.available) {
    const empty = document.createElement('div');
    empty.className = 'pi-tools-empty';
    empty.textContent = `Pi unavailable: ${result?.error || 'installation not found'}`;
    list.appendChild(empty);
    updatePiToolsSummary();
    scheduleUpdateMcpCapabilitiesSaveState();
    return;
  }

  const fragment = document.createDocumentFragment();
  if (piCapabilityTools.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pi-tools-empty';
    empty.textContent = 'No Pi tools discovered.';
    fragment.appendChild(empty);
  }

  for (const tool of piCapabilityTools) {
    const row = document.createElement('div');
    row.className = 'pi-tool-item';
    const toolPlugin = getPiToolPlugin(tool);
    const sourceInfo = tool.sourceInfo || {};
    row.dataset.plugin = toolPlugin;
    row.dataset.searchText = `${tool.name || ''} ${tool.description || ''} ${toolPlugin} ${sourceInfo.source || ''} ${sourceInfo.path || ''} ${sourceInfo.scope || ''} ${sourceInfo.origin || ''}`.toLowerCase();

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'pi-tool-checkbox';
    checkbox.value = tool.name;
    checkbox.checked = savedPiToolNames.has(tool.name);

    checkbox.addEventListener('change', () => {
      updatePiToolsSummary();
      scheduleUpdateMcpCapabilitiesSaveState();
    });

    const body = document.createElement('label');
    body.htmlFor = checkbox.id = `pi-tool-${tool.name.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    const nameRow = document.createElement('div');
    nameRow.className = 'pi-tool-name-row';
    const name = document.createElement('span');
    name.className = 'pi-tool-name';
    name.textContent = tool.name;
    nameRow.appendChild(name);
    const pluginBadge = document.createElement('span');
    pluginBadge.className = 'pi-tool-plugin-badge';
    pluginBadge.textContent = toolPlugin;
    nameRow.appendChild(pluginBadge);
    if (tool.usesPiDefaultModel) {
      const warning = document.createElement('span');
      warning.className = 'pi-tool-token-warning';
      warning.textContent = 'May use Pi model tokens';
      nameRow.appendChild(warning);
    }
    const description = document.createElement('div');
    description.className = 'pi-tool-description';
    description.textContent = tool.description || 'No description provided.';
    body.append(nameRow, description);

    row.append(checkbox, body);
    fragment.appendChild(row);
  }

  if (piCapabilityTools.length > 0) {
    const filterEmpty = document.createElement('div');
    filterEmpty.id = 'pi-tools-filter-empty';
    filterEmpty.className = 'pi-tools-empty';
    filterEmpty.textContent = 'No matching Pi tools.';
    filterEmpty.style.display = 'none';
    fragment.appendChild(filterEmpty);
  }

  list.appendChild(fragment);
  updatePiToolsSummary();
  scheduleUpdateMcpCapabilitiesSaveState();
  filterPiTools(document.getElementById('pi-tools-search')?.value || '');
}

async function ensurePiCapabilitiesLoaded() {
  if (piCapabilitiesLoaded) return;
  if (piCapabilitiesLoadPromise) return piCapabilitiesLoadPromise;
  const list = document.getElementById('pi-tools-list');
  if (list) list.innerHTML = '<div class="pi-tools-empty">Loading Pi tool registry...</div>';
  piCapabilitiesLoadPromise = window.api.getPiCapabilities()
    .then(result => renderPiCapabilityTools(result))
    .catch(error => renderPiCapabilityTools({ available: false, tools: [], error: error.message }))
    .finally(() => { piCapabilitiesLoadPromise = null; });
  return piCapabilitiesLoadPromise;
}

async function initializeMcpCapabilitySettings(config) {
  const instructions = document.getElementById('mcp-instructions');
  const resetBtn = document.getElementById('reset-mcp-instructions-btn');
  const defaultToggle = document.getElementById('default-capabilities-toggle');
  const defaultPanel = document.getElementById('default-tools-panel');
  const piToggle = document.getElementById('pi-enabled-toggle');
  const panel = document.getElementById('pi-tools-panel');
  const searchInput = document.getElementById('pi-tools-search');
  const pluginDisplay = document.getElementById('pi-tools-plugin-display');
  const pluginMenu = document.getElementById('pi-tools-plugin-dropdown-menu');
  const pluginArrow = document.getElementById('pi-tools-plugin-arrow');
  const selectVisibleBtn = document.getElementById('pi-tools-select-visible-btn');
  const clearVisibleBtn = document.getElementById('pi-tools-clear-visible-btn');
  const saveBtn = document.getElementById('save-mcp-capabilities-btn');
  if (!instructions || !defaultToggle || !defaultPanel || !piToggle || !panel || !saveBtn) return;

  mcpInstructionDefaults = {
    basic: typeof config.mcpInstructionDefaults?.basic === 'string' ? config.mcpInstructionDefaults.basic : '',
    pi: typeof config.mcpInstructionDefaults?.pi === 'string' ? config.mcpInstructionDefaults.pi : ''
  };
  savedMcpInstructions = typeof config.mcpInstructions === 'string'
    ? config.mcpInstructions
    : currentMcpInstructionDefault(config.piEnabled === true);
  savedDefaultCapabilitiesEnabled = config.defaultCapabilitiesEnabled !== false;
  savedDefaultToolNames = new Set(Array.isArray(config.defaultTools) ? config.defaultTools : []);
  renderDefaultCapabilityTools(config.defaultCapabilitiesCatalog || [], Array.from(savedDefaultToolNames));
  defaultToggle.checked = savedDefaultCapabilitiesEnabled;
  defaultPanel.style.display = defaultToggle.checked ? 'block' : 'none';
  savedPiEnabled = config.piEnabled === true;
  savedPiToolNames = new Set(Array.isArray(config.piTools) ? config.piTools : []);
  instructions.value = savedMcpInstructions;
  piToggle.checked = savedPiEnabled;
  panel.style.display = piToggle.checked ? 'block' : 'none';

  instructions.addEventListener('input', scheduleUpdateMcpCapabilitiesSaveState);
  instructions.addEventListener('focus', () => focusInput(instructions, true));
  instructions.addEventListener('blur', () => focusInput(instructions, false));
  resetBtn?.addEventListener('click', resetMcpInstructions);
  defaultToggle.addEventListener('change', () => {
    defaultPanel.style.display = defaultToggle.checked ? 'block' : 'none';
    scheduleUpdateMcpCapabilitiesSaveState();
  });
  searchInput?.addEventListener('input', () => debouncedFilterPiTools(searchInput.value));
  if (pluginDisplay && pluginMenu && pluginArrow) {
    const togglePluginMenu = () => {
      const isVisible = pluginMenu.style.display === 'block';
      closeDropdowns(isVisible ? null : pluginMenu);
      setMenuVisibility(pluginMenu, pluginDisplay, pluginArrow, !isVisible);
      if (!isVisible) setActiveOption(pluginMenu, 0);
    };
    pluginDisplay.addEventListener('click', togglePluginMenu);
    pluginArrow.addEventListener('click', event => {
      event.stopPropagation();
      togglePluginMenu();
    });
    pluginDisplay.addEventListener('keydown', event => handleComboboxKeydown(event, pluginMenu, pluginDisplay, pluginArrow));
    pluginArrow.addEventListener('keydown', event => handleComboboxKeydown(event, pluginMenu, pluginDisplay, pluginArrow));
  }
  selectVisibleBtn?.addEventListener('click', () => setVisiblePiToolsSelected(true));
  clearVisibleBtn?.addEventListener('click', () => setVisiblePiToolsSelected(false));
  piToggle.addEventListener('change', async () => {
    const previousDefault = currentMcpInstructionDefault(!piToggle.checked);
    const nextDefault = currentMcpInstructionDefault(piToggle.checked);
    if (!instructions.value.trim() || instructions.value === previousDefault) {
      instructions.value = nextDefault;
    }
    panel.style.display = piToggle.checked ? 'block' : 'none';
    if (piToggle.checked) await ensurePiCapabilitiesLoaded();
    scheduleUpdateMcpCapabilitiesSaveState();
  });
  saveBtn.addEventListener('click', saveMcpCapabilitySettings);

  if (piToggle.checked) await ensurePiCapabilitiesLoaded();
  else updatePiToolsBulkButtons();
  scheduleUpdateMcpCapabilitiesSaveState();
}

document.addEventListener('DOMContentLoaded', async () => {
  const logSearch = document.getElementById('log-search-input');
  if (logSearch) {
    logSearch.addEventListener('input', () => filterLogs(logSearch.value));
  }
  // 1. Immediate sync of service state on page load/reload to prevent state desync
  try {
    const isRunning = await window.api.getServiceState();
    updateServiceUI(isRunning);
  } catch (err) {
    console.error('Failed to get initial service state:', err);
    updateServiceUI(false);
  }

  const config = await window.api.getConfig();
  applyAppearance(config.appearance || 'dark');
  applyLanguage(config.language || 'en');

  const cfPathInput = document.getElementById('cf-config-path');
  const mcpUrlInput = document.getElementById('mcp-url');
  const listenHostInput = document.getElementById('listen-host');
  const listenPortInput = document.getElementById('listen-port');
  const openaiBinaryInput = document.getElementById('openai-binary-path');
  const openaiTunnelIdInput = document.getElementById('openai-tunnel-id');
  const openaiApiKeyInput = document.getElementById('openai-api-key');
  const networkSaveBtn = document.getElementById('save-network-btn');
  const accessSaveBtn = document.getElementById('save-access-btn');
  const sandboxSaveBtn = document.getElementById('save-sandbox-btn');
  const currentMode = config.tunnelMode || 'cloudflare-named';

  if (config.autoConnect !== undefined) {
    document.getElementById('auto-connect-toggle').checked = !!config.autoConnect;
  } else {
    document.getElementById('auto-connect-toggle').checked = true;
  }

  const debugToggle = document.getElementById('debug-mode-toggle');
  if (debugToggle) {
    debugToggle.checked = !!config.debugMode;
  }

  await initializeMcpCapabilitySettings(config);
  await loadProviderFields(currentMode, config);

  if (config.fsRoot) {
    document.getElementById('fs-root').value = config.fsRoot;
  }
  const adminPassInput = document.getElementById('admin-pass');
  if (adminPassInput) {
    if (config.adminSecretNeedsReset) {
      adminPassInput.placeholder = t('Reset required — enter a new password');
      adminPassInput.dataset.needsReset = 'true';
      flashTransientHint(t('Legacy Electron password must be reset'), 'tunnel-install-hint');
    } else if (config.adminSecretConfigured) {
      adminPassInput.placeholder = '••••••••';
      adminPassInput.dataset.needsReset = 'false';
    }
  }

  const initialPolicy = config.shellPolicy || 'unrestricted';
  const policyDisplay = document.getElementById('shell-policy-display');
  if (policyDisplay) {
    policyDisplay.value = t(shellPolicyLabels[initialPolicy] || 'Unrestricted');
    policyDisplay.setAttribute('data-value', initialPolicy);
    policyDisplay.dataset.savedValue = initialPolicy;
  }

  const allow = (config.shellAllowlist || []).join(', ');
  const deny = (config.shellDenylist || []).join(', ');
  document.getElementById('shell-allow').value = allow;
  document.getElementById('shell-deny').value = deny;

  updateShellStatus(initialPolicy);
  refreshTokens();

  networkSaveBtn.disabled = false;
  accessSaveBtn.disabled = false;
  sandboxSaveBtn.disabled = false;
  document.getElementById('tunnel-mode-display').dataset.savedValue = currentMode;

  [cfPathInput, mcpUrlInput, listenHostInput, listenPortInput, openaiBinaryInput, openaiTunnelIdInput, openaiApiKeyInput].filter(Boolean).forEach(input => {
    input.dataset.savedValue = input.value;
  });
  [document.getElementById('fs-root'), document.getElementById('shell-allow'), document.getElementById('shell-deny')]
    .filter(Boolean)
    .forEach(input => {
      input.dataset.savedValue = input.value;
      input.addEventListener('input', () => {
        scheduleUpdateSandboxSaveState();
        const curPolicy = document.getElementById('shell-policy-display')?.getAttribute('data-value') || 'unrestricted';
        updateShellStatus(curPolicy);
      });
      input.addEventListener('focus', () => focusInput(input, true));
      input.addEventListener('blur', () => focusInput(input, false));
    });
  document.getElementById('admin-pass').addEventListener('input', () => {
    accessSaveBtn.disabled = !document.getElementById('admin-pass').value;
    accessSaveBtn.classList.toggle('btn-primary', !accessSaveBtn.disabled);
  });
  [cfPathInput, mcpUrlInput, listenHostInput, listenPortInput, openaiBinaryInput, openaiTunnelIdInput, openaiApiKeyInput].filter(Boolean).forEach(input => {
    input.addEventListener('focus', () => focusInput(input, true));
    input.addEventListener('blur', () => focusInput(input, false));
    input.addEventListener('input', () => {
      scheduleUpdateNetworkSaveState();
      if (input === openaiTunnelIdInput) {
        debouncedRenderConnectionGuide(getCurrentMode(), document.getElementById('mcp-url')?.value);
      }
    });
    input.addEventListener('change', scheduleUpdateNetworkSaveState);
  });

  const openaiApiKeyToggleBtn = document.getElementById('openai-api-key-toggle-btn');
  if (openaiApiKeyToggleBtn && openaiApiKeyInput) {
    openaiApiKeyToggleBtn.addEventListener('click', () => {
      const isPassword = openaiApiKeyInput.type === 'password';
      openaiApiKeyInput.type = isPassword ? 'text' : 'password';
      openaiApiKeyToggleBtn.textContent = t(isPassword ? 'Hide' : 'Show');
    });
  }

  const customCertInput = document.getElementById('custom-ssl-cert-path');
  const customKeyInput = document.getElementById('custom-ssl-key-path');
  const customCertBrowseBtn = document.getElementById('custom-ssl-cert-browse-btn');
  const customKeyBrowseBtn = document.getElementById('custom-ssl-key-browse-btn');

  if (customCertBrowseBtn && customCertInput) {
    customCertBrowseBtn.addEventListener('click', async () => {
      const chosen = await window.api.pickCertFile();
      if (chosen) {
        customCertInput.value = chosen;
        updateNetworkSaveState();
      }
    });
  }

  if (customKeyBrowseBtn && customKeyInput) {
    customKeyBrowseBtn.addEventListener('click', async () => {
      const chosen = await window.api.pickKeyFile();
      if (chosen) {
        customKeyInput.value = chosen;
        updateNetworkSaveState();
      }
    });
  }

  [customCertInput, customKeyInput].filter(Boolean).forEach(input => {
    input.addEventListener('focus', () => focusInput(input, true));
    input.addEventListener('blur', () => focusInput(input, false));
    input.addEventListener('input', updateNetworkSaveState);
    input.addEventListener('change', updateNetworkSaveState);
  });

  updateNetworkSaveState();
  updateSandboxSaveState();
  await loadInitialLogs();
});

async function loadInitialLogs() {
  try {
    const data = await window.api.getRecentLogs();

    // Clear in-memory arrays before loading to prevent duplicates
    mcpLogs.length = 0;
    tunnelLogs.length = 0;
    runtimeLogs.length = 0;

    if (data && Array.isArray(data.tunnelLogs)) {
      tunnelLogs.push(...data.tunnelLogs);
    }
    if (data && Array.isArray(data.appRuntimeLogs)) {
      runtimeLogs.push(...data.appRuntimeLogs);
    }
    if (data && Array.isArray(data.mcpLogs)) {
      mcpLogs.push(...data.mcpLogs);
    }

  if (currentMainTab === 'logs') {
    renderRecentMcpLogs();
    renderRecentTunnelLogs();
    renderRecentRuntimeLogs();
  } else {
    pendingLogsRender.mcp = true;
    pendingLogsRender.tunnel = true;
    pendingLogsRender.runtime = true;
  }
  } catch (err) {
    console.error('Failed to load initial logs:', err);
  }
}

function updateSandboxSaveState() {
  const saveBtn = document.getElementById('save-sandbox-btn');
  const policyInput = document.getElementById('shell-policy-display');
  const fsInput = document.getElementById('fs-root');
  const allowInput = document.getElementById('shell-allow');
  const denyInput = document.getElementById('shell-deny');
  if (!saveBtn || !policyInput || !fsInput || !allowInput || !denyInput) return;

  const dirty = (policyInput.getAttribute('data-value') ?? '') !== (policyInput.dataset.savedValue ?? '')
    || fsInput.value.trim() !== (fsInput.dataset.savedValue ?? '').trim()
    || allowInput.value.trim() !== (allowInput.dataset.savedValue ?? '').trim()
    || denyInput.value.trim() !== (denyInput.dataset.savedValue ?? '').trim();

  saveBtn.classList.toggle('btn-primary', dirty);
}

function updateNetworkSaveState() {
  const saveBtn = document.getElementById('save-network-btn');
  const modeInput = document.getElementById('tunnel-mode-display');
  if (!saveBtn || !modeInput) return;

  const currentMode = modeInput.getAttribute('data-value') || modeInput.dataset.value || getCurrentMode();
  const savedMode = modeInput.dataset.savedValue || '';
  const modeDirty = currentMode !== savedMode;

  const activeFields = [
    document.getElementById('listen-host'),
    document.getElementById('listen-port')
  ];

  if (currentMode === 'cloudflare-named') {
    activeFields.push(
      document.getElementById('openai-binary-path'),
      document.getElementById('cf-config-path'),
      document.getElementById('mcp-url')
    );
  } else if (currentMode === 'cloudflare-quick') {
    activeFields.push(document.getElementById('openai-binary-path'));
  } else if (currentMode === 'openai') {
    activeFields.push(
      document.getElementById('openai-binary-path'),
      document.getElementById('openai-tunnel-id'),
      document.getElementById('openai-api-key')
    );
  } else if (currentMode === 'custom') {
    activeFields.push(
      document.getElementById('mcp-url'),
      document.getElementById('custom-ssl-cert-path'),
      document.getElementById('custom-ssl-key-path')
    );
  }

  const fieldsDirty = activeFields.filter(Boolean).some(input => {
    const curVal = String(input.value ?? '').trim();
    const savedVal = String(input.dataset.savedValue ?? '').trim();
    return curVal !== savedVal;
  });

  const dirty = modeDirty || fieldsDirty;
  saveBtn.classList.toggle('btn-primary', dirty);
}

async function populateListenAddresses(selectedAddress = '') {
  const input = document.getElementById('listen-host');
  const arrow = document.getElementById('listen-address-arrow');
  const menu = document.getElementById('listen-address-dropdown-menu');
  if (!input || !arrow || !menu) return;
  try {
    const addresses = await window.api.getListenAddresses();
    menu.replaceChildren();
    const fragment = document.createDocumentFragment();
    addresses.forEach(entry => {
      const option = document.createElement('div');
      option.className = 'combobox-option';
      option.setAttribute('role', 'option');
      option.setAttribute('tabindex', '-1');
      option.setAttribute('aria-selected', 'false');
      option.dataset.value = entry.address;
      option.textContent = `${entry.address} · ${entry.name}`;
      option.addEventListener('click', event => {
        event.stopPropagation();
        input.value = option.textContent;
        input.dataset.value = entry.address;
        setMenuVisibility(menu, input, arrow, false);
        scheduleUpdateNetworkSaveState();
      });
      fragment.appendChild(option);
    });
    menu.appendChild(fragment);
    const selected = addresses.find(entry => entry.address === selectedAddress);
    input.value = selected
      ? `${selected.address} · ${selected.name}`
      : `${selectedAddress || '127.0.0.1'} · Saved address`;
    input.dataset.value = selectedAddress || '127.0.0.1';
    input.dataset.savedValue = input.value;
    arrow.style.display = 'flex';
    arrow.disabled = false;
  } catch (err) {
    console.error('Failed to load listen addresses:', err);
  }
}

async function loadProviderFields(mode, config = null) {
  const providerConfig = config || await window.api.getConfig(mode);
  window.currentMcpPath = providerConfig.mcpPath || '/mcp';
  const cfPathInput = document.getElementById('cf-config-path');
  const mcpUrlInput = document.getElementById('mcp-url');
  const listenHostInput = document.getElementById('listen-host');
  const listenPortInput = document.getElementById('listen-port');
  const openaiBinaryInput = document.getElementById('openai-binary-path');
  const openaiTunnelIdInput = document.getElementById('openai-tunnel-id');
  const openaiApiKeyInput = document.getElementById('openai-api-key');
  const tunnelDisplay = document.getElementById('tunnel-mode-display');

  cfPathInput.value = providerConfig.cfConfigPath || '';
  cfPathInput.dataset.savedValue = cfPathInput.value;
  mcpUrlInput.value = providerConfig.mcpUrl || '';
  mcpUrlInput.dataset.savedValue = mcpUrlInput.value;
  listenHostInput.value = providerConfig.listenHost || '127.0.0.1';
  listenHostInput.dataset.savedValue = listenHostInput.value;
  listenPortInput.value = providerConfig.listenPort || 3000;
  listenPortInput.dataset.savedValue = String(listenPortInput.value);

  if (openaiBinaryInput) {
    openaiBinaryInput.value = providerConfig.binaryPath || '';
    openaiBinaryInput.dataset.savedValue = openaiBinaryInput.value;
  }
  if (openaiTunnelIdInput) {
    openaiTunnelIdInput.value = providerConfig.tunnelId || '';
    openaiTunnelIdInput.dataset.savedValue = openaiTunnelIdInput.value;
  }
  if (openaiApiKeyInput) {
    openaiApiKeyInput.value = providerConfig.tunnelApiKey || '';
    openaiApiKeyInput.dataset.savedValue = openaiApiKeyInput.value;
  }

  const customSslCertInput = document.getElementById('custom-ssl-cert-path');
  const customSslKeyInput = document.getElementById('custom-ssl-key-path');
  if (customSslCertInput) {
    customSslCertInput.value = providerConfig.sslCertPath || '';
    customSslCertInput.dataset.savedValue = customSslCertInput.value;
  }
  if (customSslKeyInput) {
    customSslKeyInput.value = providerConfig.sslKeyPath || '';
    customSslKeyInput.dataset.savedValue = customSslKeyInput.value;
  }

  tunnelDisplay.value = t(modeLabels[mode] || mode);
  tunnelDisplay.setAttribute('data-value', mode);
  tunnelDisplay.dataset.value = mode;
  await populateListenAddresses(providerConfig.listenHost);
  await updateTunnelModeFields(mode);
}

function updateServiceUI(isRunning) {
  currentServiceRunning = !!isRunning;
  const badge = document.getElementById('status-indicator');
  const text = document.getElementById('status-text');
  const btn = document.getElementById('power-btn');
  if (!badge || !text || !btn) return;

  if (isRunning) {
    badge.className = 'status-badge';
    text.textContent = t('Running');
    btn.textContent = t('Disconnect');
    btn.className = 'btn btn-danger';
    btn.style.color = '';
    btn.style.border = '';
  } else {
    badge.className = 'status-badge is-stopped';
    text.textContent = t('Stopped');
    btn.textContent = t('Connect');
    btn.className = 'btn btn-secondary';
    btn.style.color = 'var(--green-300)';
    btn.style.border = '1px solid rgb(64 201 119 / 26%)';
  }
}

document.getElementById('power-btn').addEventListener('click', async () => {
  const button = document.getElementById('power-btn');
  if (button) button.disabled = true;
  try {
    const isCurrentlyRunning = await window.api.getServiceState();
    const newState = await window.api.toggleServiceState(!isCurrentlyRunning);
    updateServiceUI(newState);
  } catch (err) {
    const errMsg = err?.message || String(err);
    console.error('Failed to change Aura service state:', err);
    flashTransientHint(`${currentServiceRunning ? 'Disconnect' : 'Connect'} failed: ${errMsg}`, 'tunnel-install-hint');
    window.alert(`${currentServiceRunning ? 'Disconnect' : 'Connect'} failed:\n${errMsg}`);
    try {
      const realState = await window.api.getServiceState();
      updateServiceUI(realState);
    } catch (_) {
      updateServiceUI(false);
    }
  } finally {
    if (button) button.disabled = false;
  }
});

window.api.onServiceStateChanged((isRunning) => {
  updateServiceUI(isRunning);
});

document.getElementById('auto-connect-toggle').addEventListener('change', async (e) => {
  await window.api.saveConfig({ autoConnect: e.target.checked });
});

const debugModeToggle = document.getElementById('debug-mode-toggle');
if (debugModeToggle) {
  debugModeToggle.addEventListener('change', async (e) => {
    await window.api.saveConfig({ debugMode: e.target.checked });
    flashTransientHint(t(e.target.checked ? 'Debug mode enabled (verbose logging)' : 'Debug mode disabled'), 'tunnel-install-hint');
  });
}

async function refreshTokens() {
  const tokens = await window.api.getTokens();
  const listEl = document.getElementById('tokens-list');
  listEl.replaceChildren();

  if (tokens.length === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'token-empty-state';

    const emptyTitle = document.createElement('strong');
    emptyTitle.textContent = t('No active tokens');

    const emptyDetail = document.createElement('span');
    emptyDetail.textContent = t('Tokens will appear here after an MCP client completes authorization.');

    emptyNotice.appendChild(emptyTitle);
    emptyNotice.appendChild(emptyDetail);
    listEl.appendChild(emptyNotice);
    return;
  }

  tokens.forEach(tokenInfo => {
    const div = document.createElement('div');
    div.className = 'token-item';

    const time = new Date(tokenInfo.issuedAt).toLocaleTimeString();
    const infoContainer = document.createElement('div');
    infoContainer.style.minWidth = '0';
    infoContainer.style.overflow = 'hidden';
    infoContainer.style.textOverflow = 'ellipsis';
    infoContainer.style.paddingRight = '8px';

    const clientIdEl = document.createElement('div');
    clientIdEl.style.color = 'var(--color-text-primary)';
    clientIdEl.style.fontWeight = '500';
    clientIdEl.textContent = tokenInfo.client_id;

    const metaEl = document.createElement('div');
    metaEl.className = 'token-meta';

    const durationText = tokenInfo.duration || 'unknown';
    const durationBadge = document.createElement('span');
    durationBadge.className = 'token-badge is-duration';
    durationBadge.textContent = durationText;

    const validBadge = document.createElement('span');
    validBadge.className = 'token-badge is-valid';
    validBadge.textContent = t('Active');

    metaEl.appendChild(durationBadge);
    metaEl.appendChild(validBadge);

    const issuedEl = document.createElement('div');
    issuedEl.style.color = 'var(--color-text-tertiary)';
    issuedEl.style.fontSize = '10px';
    issuedEl.textContent = `${t('Issued')} ${time}`;

    infoContainer.appendChild(clientIdEl);
    infoContainer.appendChild(issuedEl);
    infoContainer.appendChild(metaEl);

    const revokeBtn = document.createElement('button');
    revokeBtn.className = 'btn btn-danger';
    revokeBtn.textContent = t('Revoke');
    revokeBtn.addEventListener('click', async () => {
      const originalText = revokeBtn.textContent;
      revokeBtn.disabled = true;
      revokeBtn.classList.add('is-loading');
      revokeBtn.textContent = t('Revoking');
      try {
        await window.api.revokeToken(tokenInfo.token);
        flashTransientHint(t('Token revoked'), 'tunnel-install-hint');
        await refreshTokens();
      } catch (err) {
        console.error('Failed to revoke token:', err);
        flashTransientHint(t('Failed to revoke token'), 'tunnel-install-hint');
        revokeBtn.textContent = originalText;
        revokeBtn.disabled = false;
        revokeBtn.classList.remove('is-loading');
      }
    });

    div.appendChild(infoContainer);
    div.appendChild(revokeBtn);
    listEl.appendChild(div);
  });
}

document.getElementById('refresh-tokens-btn').addEventListener('click', async () => {
  const btn = document.getElementById('refresh-tokens-btn');
  btn.classList.add('is-loading');
  try {
    await refreshTokens();
  } finally {
    btn.classList.remove('is-loading');
  }
});

function updateShellStatus(policy) {
  const statusEl = document.getElementById('shell-status');
  if (!statusEl) return;
  if (policy === 'unrestricted') {
    statusEl.textContent = t('Status: Unrestricted (All commands allowed)');
    statusEl.style.color = 'var(--orange-300)';
  } else if (policy === 'allowlist') {
    statusEl.textContent = t('Status: Allowlist only (Only allowed commands permitted)');
    statusEl.style.color = 'var(--green-300)';
  } else if (policy === 'denylist') {
    statusEl.textContent = t('Status: Denylist enforced (Blocked commands will be rejected)');
    statusEl.style.color = 'var(--green-300)';
  }
}

function flashSaveFeedback(btn, successText = 'Saved ✓') {
  if (!btn) return;
  const localizedSuccessText = t(successText);
  btn.textContent = localizedSuccessText;
  btn.classList.remove('is-loading');
  btn.classList.add('btn-success');
  setTimeout(() => {
    if (btn.textContent === localizedSuccessText) {
      btn.textContent = t('Save');
    }
    btn.classList.remove('btn-success');
  }, 1400);
}

function flashTransientHint(text, elId) {
  const hintEl = document.getElementById(elId);
  if (!hintEl) return;
  const previous = hintEl.textContent;
  hintEl.textContent = text;
  setTimeout(() => {
    if (hintEl.textContent === text) {
      hintEl.textContent = previous;
    }
  }, 1100);
}

document.getElementById('tunnel-doc-link').addEventListener('click', (e) => {
  e.preventDefault();
  const mode = document.getElementById('tunnel-mode-display').getAttribute('data-value') || 'cloudflare-named';
  if (mode === 'openai') {
    window.api.openExternal('https://github.com/openai/tunnel-client');
  } else {
    window.api.openExternal('https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
  }
});

// Accessible custom dropdowns for preferences, Tunnel Mode, hostname, and config file.
const languageMenu = document.getElementById('language-dropdown-menu');
const languageArrowBtn = document.getElementById('language-arrow');
const languageDisplay = document.getElementById('language-display');
const appearanceMenu = document.getElementById('appearance-dropdown-menu');
const appearanceArrowBtn = document.getElementById('appearance-arrow');
const appearanceDisplay = document.getElementById('appearance-display');
const tunnelMenu = document.getElementById('tunnel-mode-dropdown-menu');
const tunnelArrowBtn = document.getElementById('tunnel-mode-arrow');
const tunnelDisplay = document.getElementById('tunnel-mode-display');
const dropdownMenu = document.getElementById('cf-dropdown-menu');
const arrowBtn = document.getElementById('cf-hostname-arrow');
const configDropdownMenu = document.getElementById('cf-config-dropdown-menu');
const configArrowBtn = document.getElementById('cf-config-arrow');
const configInput = document.getElementById('cf-config-path');
const openaiBinaryMenu = document.getElementById('openai-binary-dropdown-menu');
const openaiBinaryArrowBtn = document.getElementById('openai-binary-arrow');
const openaiBinaryInput = document.getElementById('openai-binary-path');
const customSslCertMenu = document.getElementById('custom-ssl-cert-dropdown-menu');
const customSslCertArrowBtn = document.getElementById('custom-ssl-cert-arrow');
const customSslCertInput = document.getElementById('custom-ssl-cert-path');

function setMenuVisibility(menu, input, arrow, isVisible) {
  if (!menu || !input || !arrow) return;
  menu.style.display = isVisible ? 'block' : 'none';
  input.setAttribute('aria-expanded', String(isVisible));
  arrow.setAttribute('aria-expanded', String(isVisible));
  menu.setAttribute('aria-hidden', String(!isVisible));
  if (!isVisible) {
    menu.querySelectorAll('[role="option"]').forEach(option => {
      option.classList.remove('is-active');
      option.setAttribute('aria-selected', 'false');
    });
    delete menu.dataset.activeIndex;
  }
}

function closeDropdowns(except = null) {
  const listenAddressMenu = document.getElementById('listen-address-dropdown-menu');
  const listenAddressInput = document.getElementById('listen-host');
  const listenAddressArrow = document.getElementById('listen-address-arrow');
  const shellPolicyMenu = document.getElementById('shell-policy-dropdown-menu');
  const shellPolicyDisplay = document.getElementById('shell-policy-display');
  const shellPolicyArrowBtn = document.getElementById('shell-policy-arrow');
  const pluginMenu = document.getElementById('pi-tools-plugin-dropdown-menu');
  const pluginDisplay = document.getElementById('pi-tools-plugin-display');
  const pluginArrow = document.getElementById('pi-tools-plugin-arrow');
  if (except !== languageMenu) setMenuVisibility(languageMenu, languageDisplay, languageArrowBtn, false);
  if (except !== appearanceMenu) setMenuVisibility(appearanceMenu, appearanceDisplay, appearanceArrowBtn, false);
  if (except !== tunnelMenu) setMenuVisibility(tunnelMenu, tunnelDisplay, tunnelArrowBtn, false);
  if (except !== dropdownMenu) setMenuVisibility(dropdownMenu, document.getElementById('mcp-url'), arrowBtn, false);
  if (except !== configDropdownMenu) setMenuVisibility(configDropdownMenu, configInput, configArrowBtn, false);
  if (except !== openaiBinaryMenu) setMenuVisibility(openaiBinaryMenu, openaiBinaryInput, openaiBinaryArrowBtn, false);
  if (except !== customSslCertMenu) setMenuVisibility(customSslCertMenu, customSslCertInput, customSslCertArrowBtn, false);
  if (listenAddressMenu && listenAddressInput && listenAddressArrow && except !== listenAddressMenu) {
    setMenuVisibility(listenAddressMenu, listenAddressInput, listenAddressArrow, false);
  }
  if (shellPolicyMenu && shellPolicyDisplay && shellPolicyArrowBtn && except !== shellPolicyMenu) {
    setMenuVisibility(shellPolicyMenu, shellPolicyDisplay, shellPolicyArrowBtn, false);
  }
  if (pluginMenu && pluginDisplay && pluginArrow && except !== pluginMenu) {
    setMenuVisibility(pluginMenu, pluginDisplay, pluginArrow, false);
  }
}

function setActiveOption(menu, index) {
  const options = Array.from(menu.querySelectorAll('[role="option"]'));
  if (!options.length) return;
  const nextIndex = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    const active = optionIndex === nextIndex;
    option.classList.toggle('is-active', active);
    option.setAttribute('aria-selected', String(active));
  });
  menu.dataset.activeIndex = String(nextIndex);
}

function handleComboboxKeydown(event, menu, input, arrow) {
  const options = Array.from(menu.querySelectorAll('[role="option"]'));
  const isArrowTrigger = event.currentTarget === arrow;
  const isEditableInput = !input.readOnly;
  if (isArrowTrigger && (event.key === 'Enter' || event.key === ' ')) return;
  if (isEditableInput && !isArrowTrigger && (event.key === 'Enter' || event.key === ' ')) return;
  if (event.key === 'Escape') {
    if (menu.style.display === 'block') {
      event.preventDefault();
      setMenuVisibility(menu, input, arrow, false);
      input.focus();
    }
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;

  if (event.key === 'Enter' || event.key === ' ') {
    if (menu.style.display !== 'block') {
      event.preventDefault();
      if (options.length) {
        setMenuVisibility(menu, input, arrow, true);
        setActiveOption(menu, 0);
      }
      return;
    }
    const activeIndex = Number(menu.dataset.activeIndex);
    if (Number.isInteger(activeIndex) && options[activeIndex]) {
      event.preventDefault();
      options[activeIndex].click();
    }
    return;
  }

  if (!options.length) return;
  event.preventDefault();
  if (menu.style.display !== 'block') {
    closeDropdowns(menu);
    setMenuVisibility(menu, input, arrow, true);
  }
  const currentIndex = Number(menu.dataset.activeIndex);
  const index = Number.isInteger(currentIndex) ? currentIndex : 0;
  if (event.key === 'ArrowDown') setActiveOption(menu, index + 1);
  if (event.key === 'ArrowUp') setActiveOption(menu, index - 1);
  if (event.key === 'Home') setActiveOption(menu, 0);
  if (event.key === 'End') setActiveOption(menu, options.length - 1);
}

function toggleLanguageMenu() {
  const isVisible = languageMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : languageMenu);
  setMenuVisibility(languageMenu, languageDisplay, languageArrowBtn, !isVisible);
  if (!isVisible) setActiveOption(languageMenu, currentLanguage === 'zh-CN' ? 1 : 0);
}

function toggleAppearanceMenu() {
  const isVisible = appearanceMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : appearanceMenu);
  setMenuVisibility(appearanceMenu, appearanceDisplay, appearanceArrowBtn, !isVisible);
  if (!isVisible) setActiveOption(appearanceMenu, currentAppearance === 'light' ? 1 : 0);
}

function toggleTunnelMenu() {
  const isVisible = tunnelMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : tunnelMenu);
  setMenuVisibility(tunnelMenu, tunnelDisplay, tunnelArrowBtn, !isVisible);
  if (!isVisible) setActiveOption(tunnelMenu, 0);
}

function toggleHostnameMenu() {
  const input = document.getElementById('mcp-url');
  const isVisible = dropdownMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : dropdownMenu);
  setMenuVisibility(dropdownMenu, input, arrowBtn, !isVisible);
  if (!isVisible) setActiveOption(dropdownMenu, 0);
}

function toggleConfigMenu() {
  const isVisible = configDropdownMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : configDropdownMenu);
  setMenuVisibility(configDropdownMenu, configInput, configArrowBtn, !isVisible);
  if (!isVisible) setActiveOption(configDropdownMenu, 0);
}

function toggleOpenaiBinaryMenu() {
  if (!openaiBinaryMenu || !openaiBinaryInput || !openaiBinaryArrowBtn) return;
  const isVisible = openaiBinaryMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : openaiBinaryMenu);
  setMenuVisibility(openaiBinaryMenu, openaiBinaryInput, openaiBinaryArrowBtn, !isVisible);
  if (!isVisible) setActiveOption(openaiBinaryMenu, 0);
}

function toggleCustomSslCertMenu() {
  if (!customSslCertMenu || !customSslCertInput || !customSslCertArrowBtn) return;
  const isVisible = customSslCertMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : customSslCertMenu);
  setMenuVisibility(customSslCertMenu, customSslCertInput, customSslCertArrowBtn, !isVisible);
  if (!isVisible) setActiveOption(customSslCertMenu, 0);
}

languageArrowBtn.addEventListener('click', toggleLanguageMenu);
languageDisplay.addEventListener('click', toggleLanguageMenu);
languageDisplay.addEventListener('keydown', event => handleComboboxKeydown(event, languageMenu, languageDisplay, languageArrowBtn));
languageArrowBtn.addEventListener('keydown', event => handleComboboxKeydown(event, languageMenu, languageDisplay, languageArrowBtn));

appearanceArrowBtn.addEventListener('click', toggleAppearanceMenu);
appearanceDisplay.addEventListener('click', toggleAppearanceMenu);
appearanceDisplay.addEventListener('keydown', event => handleComboboxKeydown(event, appearanceMenu, appearanceDisplay, appearanceArrowBtn));
appearanceArrowBtn.addEventListener('keydown', event => handleComboboxKeydown(event, appearanceMenu, appearanceDisplay, appearanceArrowBtn));

tunnelArrowBtn.addEventListener('click', toggleTunnelMenu);
tunnelDisplay.addEventListener('click', toggleTunnelMenu);
tunnelDisplay.addEventListener('keydown', event => handleComboboxKeydown(event, tunnelMenu, tunnelDisplay, tunnelArrowBtn));
tunnelArrowBtn.addEventListener('keydown', event => handleComboboxKeydown(event, tunnelMenu, tunnelDisplay, tunnelArrowBtn));

const hostnameInput = document.getElementById('mcp-url');
arrowBtn.addEventListener('click', event => {
  event.stopPropagation();
  toggleHostnameMenu();
});
hostnameInput.addEventListener('keydown', event => handleComboboxKeydown(event, dropdownMenu, hostnameInput, arrowBtn));
arrowBtn.addEventListener('keydown', event => handleComboboxKeydown(event, dropdownMenu, hostnameInput, arrowBtn));

configArrowBtn.addEventListener('click', event => {
  event.stopPropagation();
  toggleConfigMenu();
});
configInput.addEventListener('keydown', event => handleComboboxKeydown(event, configDropdownMenu, configInput, configArrowBtn));
configArrowBtn.addEventListener('keydown', event => handleComboboxKeydown(event, configDropdownMenu, configInput, configArrowBtn));

if (openaiBinaryArrowBtn && openaiBinaryInput && openaiBinaryMenu) {
  openaiBinaryArrowBtn.addEventListener('click', event => {
    event.stopPropagation();
    toggleOpenaiBinaryMenu();
  });
  openaiBinaryInput.addEventListener('click', event => {
    event.stopPropagation();
    if (openaiBinaryMenu.style.display !== 'block') toggleOpenaiBinaryMenu();
  });
  openaiBinaryInput.addEventListener('keydown', event => handleComboboxKeydown(event, openaiBinaryMenu, openaiBinaryInput, openaiBinaryArrowBtn));
  openaiBinaryArrowBtn.addEventListener('keydown', event => handleComboboxKeydown(event, openaiBinaryMenu, openaiBinaryInput, openaiBinaryArrowBtn));
}

if (customSslCertArrowBtn && customSslCertInput && customSslCertMenu) {
  customSslCertArrowBtn.addEventListener('click', event => {
    event.stopPropagation();
    toggleCustomSslCertMenu();
  });
  customSslCertInput.addEventListener('keydown', event => handleComboboxKeydown(event, customSslCertMenu, customSslCertInput, customSslCertArrowBtn));
  customSslCertArrowBtn.addEventListener('keydown', event => handleComboboxKeydown(event, customSslCertMenu, customSslCertInput, customSslCertArrowBtn));
}

languageMenu.querySelectorAll('[role="option"]').forEach(option => {
  option.setAttribute('aria-selected', 'false');
  option.addEventListener('click', async event => {
    event.stopPropagation();
    const instructions = document.getElementById('mcp-instructions');
    const previousDefault = currentMcpInstructionDefault();
    const wasUsingDefault = !!instructions && (!instructions.value.trim() || instructions.value === previousDefault);
    const language = option.getAttribute('data-value');
    setMenuVisibility(languageMenu, languageDisplay, languageArrowBtn, false);
    applyLanguage(language);
    const updatedConfig = await window.api.saveConfig({ language: currentLanguage });
    mcpInstructionDefaults = {
      basic: typeof updatedConfig?.mcpInstructionDefaults?.basic === 'string' ? updatedConfig.mcpInstructionDefaults.basic : '',
      pi: typeof updatedConfig?.mcpInstructionDefaults?.pi === 'string' ? updatedConfig.mcpInstructionDefaults.pi : ''
    };
    if (typeof updatedConfig?.mcpInstructions === 'string') {
      savedMcpInstructions = updatedConfig.mcpInstructions;
    }
    if (wasUsingDefault && instructions) {
      instructions.value = currentMcpInstructionDefault();
    }
    scheduleUpdateMcpCapabilitiesSaveState();
  });
});

appearanceMenu.querySelectorAll('[role="option"]').forEach(option => {
  option.setAttribute('aria-selected', 'false');
  option.addEventListener('click', async event => {
    event.stopPropagation();
    const appearance = option.getAttribute('data-value');
    setMenuVisibility(appearanceMenu, appearanceDisplay, appearanceArrowBtn, false);
    applyAppearance(appearance);
    await window.api.saveConfig({ appearance: currentAppearance });
  });
});

tunnelMenu.querySelectorAll('[role="option"]').forEach(option => {
  option.setAttribute('aria-selected', 'false');
  option.addEventListener('click', async event => {
    event.stopPropagation();
    const mode = option.getAttribute('data-value');
    setMenuVisibility(tunnelMenu, tunnelDisplay, tunnelArrowBtn, false);
    await loadProviderFields(mode);
    updateNetworkSaveState();
  });
});

const shellPolicyMenu = document.getElementById('shell-policy-dropdown-menu');
const shellPolicyArrowBtn = document.getElementById('shell-policy-arrow');
const shellPolicyDisplay = document.getElementById('shell-policy-display');

function toggleShellPolicyMenu() {
  const isVisible = shellPolicyMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : shellPolicyMenu);
  setMenuVisibility(shellPolicyMenu, shellPolicyDisplay, shellPolicyArrowBtn, !isVisible);
  if (!isVisible) setActiveOption(shellPolicyMenu, 0);
}

shellPolicyArrowBtn.addEventListener('click', toggleShellPolicyMenu);
shellPolicyDisplay.addEventListener('click', toggleShellPolicyMenu);
shellPolicyDisplay.addEventListener('keydown', event => handleComboboxKeydown(event, shellPolicyMenu, shellPolicyDisplay, shellPolicyArrowBtn));
shellPolicyArrowBtn.addEventListener('keydown', event => handleComboboxKeydown(event, shellPolicyMenu, shellPolicyDisplay, shellPolicyArrowBtn));

shellPolicyMenu.querySelectorAll('[role="option"]').forEach(option => {
  option.setAttribute('aria-selected', 'false');
  option.addEventListener('click', event => {
    event.stopPropagation();
    const policy = option.getAttribute('data-value');
    shellPolicyDisplay.value = t(shellPolicyLabels[policy] || policy);
    shellPolicyDisplay.setAttribute('data-value', policy);
    setMenuVisibility(shellPolicyMenu, shellPolicyDisplay, shellPolicyArrowBtn, false);
    updateSandboxSaveState();
    updateShellStatus(policy);
  });
});

setMenuVisibility(languageMenu, languageDisplay, languageArrowBtn, false);
setMenuVisibility(appearanceMenu, appearanceDisplay, appearanceArrowBtn, false);
setMenuVisibility(tunnelMenu, tunnelDisplay, tunnelArrowBtn, false);
setMenuVisibility(dropdownMenu, hostnameInput, arrowBtn, false);
setMenuVisibility(configDropdownMenu, configInput, configArrowBtn, false);
setMenuVisibility(openaiBinaryMenu, openaiBinaryInput, openaiBinaryArrowBtn, false);
setMenuVisibility(customSslCertMenu, customSslCertInput, customSslCertArrowBtn, false);
setMenuVisibility(shellPolicyMenu, shellPolicyDisplay, shellPolicyArrowBtn, false);

async function saveNetworkSettings() {
  const networkSaveBtn = document.getElementById('save-network-btn');
  const modeInput = document.getElementById('tunnel-mode-display');
  const cfPathInput = document.getElementById('cf-config-path');
  const urlInput = document.getElementById('mcp-url');
  const hostInput = document.getElementById('listen-host');
  const portInput = document.getElementById('listen-port');
  const binaryInput = document.getElementById('openai-binary-path');
  const tunnelIdInput = document.getElementById('openai-tunnel-id');
  const apiKeyInput = document.getElementById('openai-api-key');
  const sslCertInput = document.getElementById('custom-ssl-cert-path');
  const sslKeyInput = document.getElementById('custom-ssl-key-path');

  const rawPort = portInput ? String(portInput.value).trim() : '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    flashTransientHint('Enter a valid port between 1 and 65535', 'tunnel-install-hint');
    if (portInput) portInput.focus();
    return;
  }

  if (networkSaveBtn) networkSaveBtn.classList.add('is-loading');
  try {
    const mode = getCurrentMode();
    const configPayload = {
      tunnelMode: mode,
      cfConfigPath: cfPathInput ? cfPathInput.value.trim() : '',
      mcpUrl: urlInput ? urlInput.value.trim() : '',
      listenHost: hostInput ? (hostInput.dataset.value || hostInput.value.split(' · ')[0]) : '127.0.0.1',
      listenPort: port,
      binaryPath: binaryInput ? binaryInput.value.trim() : '',
      tunnelId: tunnelIdInput ? tunnelIdInput.value.trim() : '',
      tunnelApiKey: apiKeyInput ? apiKeyInput.value.trim() : '',
      sslCertPath: sslCertInput ? sslCertInput.value.trim() : '',
      sslKeyPath: sslKeyInput ? sslKeyInput.value.trim() : ''
    };

    await window.api.saveConfig(configPayload);

    // Direct synchronization of saved values without race conditions
    if (cfPathInput) cfPathInput.dataset.savedValue = cfPathInput.value;
    if (urlInput) urlInput.dataset.savedValue = urlInput.value;
    if (hostInput) hostInput.dataset.savedValue = hostInput.value;
    if (portInput) portInput.dataset.savedValue = String(port);
    if (binaryInput) binaryInput.dataset.savedValue = binaryInput.value;
    if (tunnelIdInput) tunnelIdInput.dataset.savedValue = tunnelIdInput.value;
    if (apiKeyInput) apiKeyInput.dataset.savedValue = apiKeyInput.value;
    if (sslCertInput) sslCertInput.dataset.savedValue = sslCertInput.value;
    if (sslKeyInput) sslKeyInput.dataset.savedValue = sslKeyInput.value;

    if (modeInput) {
      modeInput.dataset.savedValue = mode;
      modeInput.dataset.value = mode;
      modeInput.setAttribute('data-value', mode);
    }

    updateNetworkSaveState();
    renderConnectionGuide(mode, urlInput ? urlInput.value : '');
    await restartCurrentServices(mode);
    if (networkSaveBtn) flashSaveFeedback(networkSaveBtn);
  } catch (err) {
    console.error('Failed to save network settings:', err);
    flashTransientHint('Failed to save settings: ' + err.message, 'tunnel-install-hint');
  } finally {
    if (networkSaveBtn) networkSaveBtn.classList.remove('is-loading');
  }
}

window.saveNetworkSettings = saveNetworkSettings;
window.saveAccessSettings = saveAccessSettings;
window.saveSandboxSettings = saveSandboxSettings;

async function saveAccessSettings() {
  const accessSaveBtn = document.getElementById('save-access-btn');
  const input = document.getElementById('admin-pass');
  if (!input || !input.value) {
    flashTransientHint('Enter a password to save', 'tunnel-install-hint');
    if (input) input.focus();
    return;
  }
  if (accessSaveBtn) accessSaveBtn.classList.add('is-loading');
  try {
    if (await window.api.saveSecret(input.value)) {
      input.value = '';
      input.placeholder = '••••••••';
      input.dataset.needsReset = 'false';
      if (accessSaveBtn) {
        accessSaveBtn.classList.remove('btn-primary');
        flashSaveFeedback(accessSaveBtn);
      }
    }
  } finally {
    if (accessSaveBtn) accessSaveBtn.classList.remove('is-loading');
  }
}

async function saveMcpCapabilitySettings() {
  const saveBtn = document.getElementById('save-mcp-capabilities-btn');
  const instructions = document.getElementById('mcp-instructions');
  const defaultToggle = document.getElementById('default-capabilities-toggle');
  const piToggle = document.getElementById('pi-enabled-toggle');
  if (!saveBtn || !instructions || !defaultToggle || !piToggle) return;

  if (piToggle.checked && !piCapabilitiesLoaded) {
    await ensurePiCapabilitiesLoaded();
  }

  const selectedDefaultTools = getSelectedDefaultToolNames();
  const selectedTools = getSelectedPiToolNames();
  const selectedToolSet = new Set(selectedTools);
  const allowPiModelTools = piCapabilityTools.some(tool => tool.usesPiDefaultModel && selectedToolSet.has(tool.name));
  const mcpContractChanged = instructions.value !== savedMcpInstructions
    || defaultToggle.checked !== savedDefaultCapabilitiesEnabled
    || JSON.stringify(selectedDefaultTools) !== JSON.stringify(Array.from(savedDefaultToolNames).sort())
    || piToggle.checked !== savedPiEnabled
    || JSON.stringify(selectedTools) !== JSON.stringify(Array.from(savedPiToolNames).sort());

  saveBtn.classList.add('is-loading');
  try {
    await window.api.saveConfig({
      mcpInstructions: instructions.value,
      defaultCapabilitiesEnabled: defaultToggle.checked,
      defaultTools: selectedDefaultTools,
      piEnabled: piToggle.checked,
      piTools: selectedTools,
      piAllowModelTools: allowPiModelTools
    });

    savedMcpInstructions = instructions.value;
    savedDefaultCapabilitiesEnabled = defaultToggle.checked;
    savedDefaultToolNames = new Set(selectedDefaultTools);
    savedPiEnabled = piToggle.checked;
    savedPiToolNames = new Set(selectedTools);
    updateMcpCapabilitiesSaveState();
    flashSaveFeedback(saveBtn);

    const isRunning = await window.api.getServiceState();
    if (isRunning) await restartCurrentServices();

    if (mcpContractChanged) {
      window.alert(currentLanguage === 'zh-CN'
        ? 'MCP 指令或能力已更新。\n\n请前往 ChatGPT 插件页面点击“刷新”，或重新连接 Aura，以加载最新配置。'
        : 'MCP instructions or capabilities were updated.\n\nOpen the ChatGPT plugin page and click “Refresh”, or reconnect Aura to load the latest configuration.');
    }
  } catch (err) {
    console.error('Failed to save MCP/Pi settings:', err);
    flashTransientHint('Failed to save MCP/Pi settings: ' + err.message, 'tunnel-install-hint');
  } finally {
    saveBtn.classList.remove('is-loading');
  }
}

async function saveSandboxSettings() {
  const sandboxSaveBtn = document.getElementById('save-sandbox-btn');
  const fsInput = document.getElementById('fs-root');
  const allowInput = document.getElementById('shell-allow');
  const denyInput = document.getElementById('shell-deny');
  const policyInput = document.getElementById('shell-policy-display');
  const policy = policyInput ? (policyInput.getAttribute('data-value') || 'unrestricted') : 'unrestricted';

  if (sandboxSaveBtn) sandboxSaveBtn.classList.add('is-loading');
  try {
    await window.api.saveConfig({
      shellPolicy: policy,
      fsRoot: fsInput ? fsInput.value : '~/',
      shellAllowlist: allowInput ? allowInput.value.split(',').map(s => s.trim()).filter(Boolean) : [],
      shellDenylist: denyInput ? denyInput.value.split(',').map(s => s.trim()).filter(Boolean) : []
    });
    [fsInput, allowInput, denyInput].filter(Boolean).forEach(input => { input.dataset.savedValue = input.value; });
    if (policyInput) policyInput.dataset.savedValue = policy;
    if (sandboxSaveBtn) {
      sandboxSaveBtn.classList.remove('btn-primary');
      flashSaveFeedback(sandboxSaveBtn);
    }
    updateShellStatus(policy);
  } finally {
    if (sandboxSaveBtn) sandboxSaveBtn.classList.remove('is-loading');
  }
}

// Global high-priority click handler for buttons and tabs
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!target) return;

  const saveNetwork = target.closest('#save-network-btn');
  if (saveNetwork) {
    event.preventDefault();
    saveNetworkSettings();
    return;
  }
  const saveAccess = target.closest('#save-access-btn');
  if (saveAccess) {
    event.preventDefault();
    saveAccessSettings();
    return;
  }
  const saveSandbox = target.closest('#save-sandbox-btn');
  if (saveSandbox) {
    event.preventDefault();
    saveSandboxSettings();
    return;
  }
  const tabSettings = target.closest('#tab-btn-settings');
  if (tabSettings) {
    event.preventDefault();
    switchMainTab('settings');
    return;
  }
  const tabLogs = target.closest('#tab-btn-logs');
  if (tabLogs) {
    event.preventDefault();
    switchMainTab('logs');
    return;
  }
  const subtabM = target.closest('#log-subtab-mcp');
  if (subtabM) {
    event.preventDefault();
    switchLogSubtab('mcp');
    return;
  }
  const subtabR = target.closest('#log-subtab-runtime');
  if (subtabR) {
    event.preventDefault();
    switchLogSubtab('runtime');
    return;
  }
  const exportBtn = target.closest('#export-safe-log-btn');
  if (exportBtn) {
    event.preventDefault();
    exportSafeLog();
    return;
  }
  const clearBtn = target.closest('#clear-all-logs-btn');
  if (clearBtn) {
    event.preventDefault();
    clearAllLogs();
    return;
  }

  if (target.closest?.('.input-combobox, .button-cluster, button, a')) return;
  closeDropdowns();
});

const listenAddressWrapper = document.getElementById('listen-address-combobox-wrapper');
const listenAddressInput = document.getElementById('listen-host');
const listenAddressMenu = document.getElementById('listen-address-dropdown-menu');
const listenAddressArrow = document.getElementById('listen-address-arrow');
function toggleListenAddressMenu() {
  if (!listenAddressMenu || !listenAddressInput || !listenAddressArrow) return;
  const isVisible = listenAddressMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : listenAddressMenu);
  setMenuVisibility(listenAddressMenu, listenAddressInput, listenAddressArrow, !isVisible);
  if (!isVisible) setActiveOption(listenAddressMenu, 0);
}
if (listenAddressWrapper && listenAddressInput && listenAddressArrow && listenAddressMenu) {
  listenAddressWrapper.addEventListener('click', event => {
    if (event.target.closest('.combobox-option')) return;
    event.stopPropagation();
    toggleListenAddressMenu();
  });
  listenAddressInput.addEventListener('keydown', event => handleComboboxKeydown(event, listenAddressMenu, listenAddressInput, listenAddressArrow));
  listenAddressArrow.addEventListener('keydown', event => handleComboboxKeydown(event, listenAddressMenu, listenAddressInput, listenAddressArrow));
}

function formatServerMcpUrl(baseUrl, mcpPath = '/mcp') {
  if (!baseUrl) return '';
  let trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const pathPart = mcpPath && mcpPath.startsWith('/') ? mcpPath : `/${mcpPath || 'mcp'}`;
  if (trimmed.endsWith(pathPart)) return trimmed;
  return `${trimmed}${pathPart}`;
}

function createGuideRow(label, badgeText) {
  const row = document.createElement('div');
  row.className = 'guide-row';

  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;

  const badge = document.createElement('span');
  badge.className = 'copyable-badge';
  badge.title = 'Double click to copy';
  badge.setAttribute('data-copy', badgeText);
  badge.textContent = badgeText;

  row.appendChild(labelSpan);
  row.appendChild(badge);
  return row;
}

function renderConnectionGuide(mode, url) {
  const container = document.getElementById('endpoint-guide-container');
  container.replaceChildren();

  const box = document.createElement('div');
  box.className = 'guide-box';

  const header = document.createElement('div');
  header.className = 'guide-box-header';

  const headerTitle = document.createElement('strong');
  const tagSpan = document.createElement('span');
  tagSpan.style.fontSize = '10px';
  tagSpan.style.fontWeight = '500';

  if (mode === 'openai') {
    const currentTunnelId = document.getElementById('openai-tunnel-id')?.value?.trim() || '';
    headerTitle.textContent = 'ChatGPT Connector Setup';
    tagSpan.style.color = 'var(--blue-300)';
    tagSpan.textContent = 'Private Channel';
    header.appendChild(headerTitle);
    header.appendChild(tagSpan);
    box.appendChild(header);

    if (currentTunnelId) {
      box.appendChild(createGuideRow('Tunnel ID', currentTunnelId));
    }
    box.appendChild(createGuideRow('Authentication', 'None (Outbound Ingress)'));
    box.appendChild(createGuideRow('Connection Type', 'Tunnel'));

    const note = document.createElement('small');
    note.style.color = 'var(--color-text-tertiary)';
    note.style.display = 'block';
    note.style.marginTop = '8px';
    note.textContent = 'In ChatGPT Custom App setup, select "Tunnel" and provide this Tunnel ID. No public URL or OAuth endpoint required.';
    box.appendChild(note);
  } else {
    const currentMcpPath = window.currentMcpPath || '/mcp';
    const fullMcpUrl = formatServerMcpUrl(url, currentMcpPath) || `https://mcp.yourdomain.com${currentMcpPath}`;
    headerTitle.textContent = 'ChatGPT / Claude Setup';
    tagSpan.style.color = 'var(--green-300)';
    tagSpan.textContent = 'OAuth 2.1 + CIMD';
    header.appendChild(headerTitle);
    header.appendChild(tagSpan);
    box.appendChild(header);

    box.appendChild(createGuideRow('Server URL', fullMcpUrl));
    box.appendChild(createGuideRow('Auth Method', 'OAuth 2.1 (Web Passcode)'));
    box.appendChild(createGuideRow('Discovery', 'CIMD + PRM Enabled'));

    const note = document.createElement('small');
    note.style.color = 'var(--color-text-tertiary)';
    note.style.display = 'block';
    note.style.marginTop = '8px';
    note.textContent = 'Paste the Server URL into ChatGPT. Double-click any parameter to copy.';
    box.appendChild(note);
  }

  // Bind double click to copy
  box.querySelectorAll('.copyable-badge').forEach(el => {
    el.addEventListener('dblclick', async () => {
      const textToCopy = el.getAttribute('data-copy');
      try {
        await navigator.clipboard.writeText(textToCopy);
        el.classList.add('copying');
        const originalNodes = Array.from(el.childNodes);
        el.replaceChildren();
        const copiedSpan = document.createElement('span');
        copiedSpan.style.color = 'var(--green-300)';
        copiedSpan.style.fontSize = '11px';
        copiedSpan.textContent = 'Copied ✓';
        el.appendChild(copiedSpan);
        setTimeout(() => {
          el.replaceChildren(...originalNodes);
          el.classList.remove('copying');
        }, 1200);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });
  });

  container.appendChild(box);
}

async function reloadCfHostnames() {
  const urlInput = document.getElementById('mcp-url');
  const cfArrow = document.getElementById('cf-hostname-arrow');
  const dropdownMenu = document.getElementById('cf-dropdown-menu');
  const configPath = document.getElementById('cf-config-path').value;

  const cfInfo = await window.api.getCfHostnames(configPath);
  if (cfInfo && cfInfo.hostnames && cfInfo.hostnames.length > 0) {
    dropdownMenu.replaceChildren();
    const fragment = document.createDocumentFragment();
    cfInfo.hostnames.forEach(h => {
      const item = document.createElement('div');
      item.className = 'combobox-option';
      item.setAttribute('role', 'option');
      item.setAttribute('tabindex', '-1');
      item.setAttribute('aria-selected', 'false');

      const hostSpan = document.createElement('span');
      hostSpan.textContent = `https://${h}`;

      const hintSpan = document.createElement('span');
      hintSpan.style.color = 'var(--color-text-tertiary)';
      hintSpan.style.fontSize = '10px';
      hintSpan.textContent = 'ingress rule';

      item.appendChild(hostSpan);
      item.appendChild(hintSpan);

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        urlInput.value = `https://${h}`;
        scheduleUpdateNetworkSaveState();
        setMenuVisibility(dropdownMenu, urlInput, cfArrow, false);
        const mode = document.getElementById('tunnel-mode-display').getAttribute('data-value') || 'cloudflare-named';
        debouncedRenderConnectionGuide(mode, urlInput.value);
      });
      fragment.appendChild(item);
    });
    dropdownMenu.appendChild(fragment);
    cfArrow.style.display = 'flex';
    cfArrow.disabled = false;
  } else {
    cfArrow.style.display = 'none';
  }
}

async function reloadCfConfigFiles() {
  const configInput = document.getElementById('cf-config-path');
  const configArrow = document.getElementById('cf-config-arrow');
  const configMenu = document.getElementById('cf-config-dropdown-menu');

  const configs = await window.api.discoverCfConfigs();
  if (configs && configs.length > 0) {
    configMenu.replaceChildren();
    const fragment = document.createDocumentFragment();
    configs.forEach(p => {
      const item = document.createElement('div');
      item.className = 'combobox-option';
      item.setAttribute('role', 'option');
      item.setAttribute('tabindex', '-1');
      item.setAttribute('aria-selected', 'false');

      const pathSpan = document.createElement('span');
      pathSpan.style.overflow = 'hidden';
      pathSpan.style.textOverflow = 'ellipsis';
      pathSpan.textContent = p;

      const tagSpan = document.createElement('span');
      tagSpan.style.color = 'var(--color-text-tertiary)';
      tagSpan.style.fontSize = '10px';
      tagSpan.style.flex = 'none';
      tagSpan.textContent = 'detected';

      item.appendChild(pathSpan);
      item.appendChild(tagSpan);

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        configInput.value = p;
        setMenuVisibility(configMenu, configInput, configArrow, false);
        scheduleUpdateNetworkSaveState();
      });
      fragment.appendChild(item);
    });
    configMenu.appendChild(fragment);
    configArrow.style.display = 'flex';
  } else {
    configArrow.style.display = 'none';
  }
}

async function reloadTunnelBinaries(mode = getCurrentMode()) {
  const binaryInput = document.getElementById('openai-binary-path');
  const binaryArrow = document.getElementById('openai-binary-arrow');
  const binaryMenu = document.getElementById('openai-binary-dropdown-menu');
  if (!binaryInput || !binaryArrow || !binaryMenu) return;

  const options = await window.api.discoverTunnelBinaries(mode);
  const entries = Array.isArray(options) ? options : [];
  const detected = entries.find(entry => entry?.detected === true);
  binaryMenu.replaceChildren();
  const fragment = document.createDocumentFragment();

  const autoOption = document.createElement('div');
  autoOption.className = 'combobox-option';
  autoOption.setAttribute('role', 'option');
  autoOption.setAttribute('tabindex', '-1');
  autoOption.setAttribute('aria-selected', 'false');
  autoOption.dataset.value = '';

  const autoText = document.createElement('span');
  autoText.textContent = t('Auto detect (recommended)');
  const autoHint = document.createElement('span');
  autoHint.style.color = 'var(--color-text-tertiary)';
  autoHint.style.fontSize = '10px';
  autoHint.textContent = detected?.path || (mode === 'openai' ? 'tunnel-client' : 'cloudflared');
  autoOption.appendChild(autoText);
  autoOption.appendChild(autoHint);
  autoOption.addEventListener('click', event => {
    event.stopPropagation();
    binaryInput.value = '';
    setMenuVisibility(binaryMenu, binaryInput, binaryArrow, false);
    scheduleUpdateNetworkSaveState();
  });
  fragment.appendChild(autoOption);

  for (const entry of entries) {
    if (!entry?.path) continue;
    const item = document.createElement('div');
    item.className = 'combobox-option';
    item.setAttribute('role', 'option');
    item.setAttribute('tabindex', '-1');
    item.setAttribute('aria-selected', 'false');
    item.dataset.value = entry.path;

    const pathSpan = document.createElement('span');
    pathSpan.style.overflow = 'hidden';
    pathSpan.style.textOverflow = 'ellipsis';
    pathSpan.textContent = entry.path;

    const tagSpan = document.createElement('span');
    tagSpan.style.color = entry.detected ? 'var(--green-300)' : 'var(--color-text-tertiary)';
    tagSpan.style.fontSize = '10px';
    tagSpan.style.flex = 'none';
    tagSpan.textContent = t(entry.detected ? 'Detected' : 'Common path');

    item.appendChild(pathSpan);
    item.appendChild(tagSpan);
    item.addEventListener('click', event => {
      event.stopPropagation();
      binaryInput.value = entry.path;
      setMenuVisibility(binaryMenu, binaryInput, binaryArrow, false);
      scheduleUpdateNetworkSaveState();
    });
    fragment.appendChild(item);
  }

  binaryMenu.appendChild(fragment);
  binaryArrow.style.display = 'flex';
  binaryArrow.disabled = false;
  if (!binaryInput.value) {
    binaryInput.placeholder = detected?.path
      ? `${t('Auto detect')}: ${detected.path}`
      : `${t('Auto detect')}: ${mode === 'openai' ? 'tunnel-client' : 'cloudflared'}`;
  }
}

async function reloadAcmeCerts() {
  const certInput = document.getElementById('custom-ssl-cert-path');
  const certArrow = document.getElementById('custom-ssl-cert-arrow');
  const certMenu = document.getElementById('custom-ssl-cert-dropdown-menu');
  const keyInput = document.getElementById('custom-ssl-key-path');
  const mcpUrlInput = document.getElementById('mcp-url');
  if (!certInput || !certArrow || !certMenu) return;

  try {
    const certs = await window.api.discoverAcmeCerts();
    if (certs && certs.length > 0) {
      certMenu.replaceChildren();
      const fragment = document.createDocumentFragment();
      certs.forEach(cert => {
        const item = document.createElement('div');
        item.className = 'combobox-option';
        item.setAttribute('role', 'option');
        item.setAttribute('tabindex', '-1');
        item.setAttribute('aria-selected', 'false');

        const domainSpan = document.createElement('span');
        domainSpan.textContent = `${cert.domain} ${cert.isEcc ? '(ECC)' : ''}`;

        const tagSpan = document.createElement('span');
        tagSpan.style.color = 'var(--color-text-tertiary)';
        tagSpan.style.fontSize = '10px';
        tagSpan.style.flex = 'none';
        tagSpan.textContent = 'detected';

        item.appendChild(domainSpan);
        item.appendChild(tagSpan);

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          certInput.value = cert.certPath;
          if (keyInput && cert.keyPath) {
            keyInput.value = cert.keyPath;
          }
          if (mcpUrlInput && (!mcpUrlInput.value || mcpUrlInput.value.includes('mcp.yourdomain.com'))) {
            mcpUrlInput.value = `https://${cert.domain}`;
          }
          setMenuVisibility(certMenu, certInput, certArrow, false);
          scheduleUpdateNetworkSaveState();
          const mode = getCurrentMode();
          debouncedRenderConnectionGuide(mode, mcpUrlInput ? mcpUrlInput.value : '');
        });
        fragment.appendChild(item);
      });
      certMenu.appendChild(fragment);
      certArrow.style.display = 'flex';
      if (!certInput.value) {
        certInput.placeholder = `Detected: ${certs[0].domain}`;
      }
    } else {
      certArrow.style.display = 'none';
      if (!certInput.value) {
        certInput.placeholder = 'e.g. ~/.acme.sh/domain/fullchain.cer';
      }
    }
  } catch (err) {
    console.error('Failed to load acme certs:', err);
  }
}

async function updateTunnelModeFields(mode) {
  const urlInput = document.getElementById('mcp-url');
  const hintEl = document.getElementById('tunnel-install-hint');
  const linkEl = document.getElementById('tunnel-doc-link');
  const cfArrow = document.getElementById('cf-hostname-arrow');
  const cfConfigRow = document.getElementById('cf-config-row');
  const mcpUrlRow = document.getElementById('mcp-url-row');
  const openaiBinaryRow = document.getElementById('openai-binary-row');
  const openaiTunnelIdRow = document.getElementById('openai-tunnel-id-row');
  const openaiApiKeyRow = document.getElementById('openai-api-key-row');
  const customSslCertRow = document.getElementById('custom-ssl-cert-row');
  const customSslKeyRow = document.getElementById('custom-ssl-key-row');
  const tokensContainer = document.getElementById('tokens-container');
  const openaiNotice = document.getElementById('openai-connections-notice');

  urlInput.style.color = 'var(--color-text-primary)';
  closeDropdowns();

  if (mode === 'openai') {
    if (cfConfigRow) cfConfigRow.style.display = 'none';
    if (mcpUrlRow) mcpUrlRow.style.display = 'none';
    if (openaiBinaryRow) openaiBinaryRow.style.display = 'grid';
    if (openaiTunnelIdRow) openaiTunnelIdRow.style.display = 'grid';
    if (openaiApiKeyRow) openaiApiKeyRow.style.display = 'grid';
    if (customSslCertRow) customSslCertRow.style.display = 'none';
    if (customSslKeyRow) customSslKeyRow.style.display = 'none';
    if (tokensContainer) tokensContainer.style.display = 'none';
    if (openaiNotice) openaiNotice.style.display = 'block';

    cfArrow.style.display = 'none';
    hintEl.style.display = 'block';
    linkEl.textContent = 'openai/tunnel-client';
    await reloadTunnelBinaries(mode);
  } else if (mode === 'cloudflare-quick') {
    if (cfConfigRow) cfConfigRow.style.display = 'none';
    if (mcpUrlRow) mcpUrlRow.style.display = 'grid';
    if (openaiBinaryRow) openaiBinaryRow.style.display = 'grid';
    if (openaiTunnelIdRow) openaiTunnelIdRow.style.display = 'none';
    if (openaiApiKeyRow) openaiApiKeyRow.style.display = 'none';
    if (customSslCertRow) customSslCertRow.style.display = 'none';
    if (customSslKeyRow) customSslKeyRow.style.display = 'none';
    if (tokensContainer) tokensContainer.style.display = 'block';
    if (openaiNotice) openaiNotice.style.display = 'none';

    urlInput.readOnly = true;
    urlInput.style.backgroundColor = 'var(--color-background-control)';
    cfArrow.style.display = 'none';
    hintEl.style.display = 'block';
    linkEl.textContent = 'cloudflared';
    await reloadTunnelBinaries(mode);
  } else if (mode === 'cloudflare-named') {
    if (cfConfigRow) cfConfigRow.style.display = 'grid';
    if (mcpUrlRow) mcpUrlRow.style.display = 'grid';
    if (openaiBinaryRow) openaiBinaryRow.style.display = 'grid';
    if (openaiTunnelIdRow) openaiTunnelIdRow.style.display = 'none';
    if (openaiApiKeyRow) openaiApiKeyRow.style.display = 'none';
    if (customSslCertRow) customSslCertRow.style.display = 'none';
    if (customSslKeyRow) customSslKeyRow.style.display = 'none';
    if (tokensContainer) tokensContainer.style.display = 'block';
    if (openaiNotice) openaiNotice.style.display = 'none';

    urlInput.readOnly = false;
    urlInput.style.backgroundColor = 'var(--color-background-control)';
    hintEl.style.display = 'block';
    linkEl.textContent = 'cloudflared';
    await Promise.all([reloadCfConfigFiles(), reloadCfHostnames(), reloadTunnelBinaries(mode)]);
  } else {
    if (cfConfigRow) cfConfigRow.style.display = 'none';
    if (mcpUrlRow) mcpUrlRow.style.display = 'grid';
    if (openaiBinaryRow) openaiBinaryRow.style.display = 'none';
    if (openaiTunnelIdRow) openaiTunnelIdRow.style.display = 'none';
    if (openaiApiKeyRow) openaiApiKeyRow.style.display = 'none';
    if (customSslCertRow) customSslCertRow.style.display = 'grid';
    if (customSslKeyRow) customSslKeyRow.style.display = 'grid';
    if (tokensContainer) tokensContainer.style.display = 'block';
    if (openaiNotice) openaiNotice.style.display = 'none';

    urlInput.readOnly = false;
    urlInput.style.backgroundColor = 'var(--color-background-control)';
    cfArrow.style.display = 'none';
    hintEl.style.display = 'block';
    hintEl.innerHTML = 'Optional SSL: Auto-scans <code>~/.acme.sh</code> for certificates or select local cert/key for HTTPS proxy.';
    await reloadAcmeCerts();
  }
  renderConnectionGuide(mode, urlInput.value);
  updateNetworkSaveState();
}

window.api.onUrlUpdated((url) => {
  const currentMode = getCurrentMode();
  if (currentMode === 'cloudflare-quick') {
    const mcpUrlInput = document.getElementById('mcp-url');
    if (mcpUrlInput) {
      mcpUrlInput.value = url;
      mcpUrlInput.dataset.savedValue = url;
    }
  }
  updateNetworkSaveState();
  renderConnectionGuide(currentMode, url);
});

// --- Tab Switcher (Settings / Logs) & Sub-tabs Initialized in switchMainTab/switchLogSubtab ---
function getToolCategoryClass(toolName) {
  const name = String(toolName || '').toLowerCase();
  if (name.includes('read') || name.includes('search') || name.includes('get') || name.includes('list')) return 'tool-read';
  if (name.includes('write') || name.includes('save') || name.includes('edit') || name.includes('create') || name.includes('delete') || name.includes('patch')) return 'tool-write';
  if (name.includes('shell') || name.includes('exec') || name.includes('command') || name.includes('process') || name.includes('run')) return 'tool-shell';
  if (name.includes('skill')) return 'tool-skill';
  return '';
}

function attachCopyButton(headerEl, textToCopy) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'detail-copy-btn';
  btn.textContent = 'Copy';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(textToCopy);
      btn.textContent = 'Copied ✓';
      btn.classList.add('is-copied');
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('is-copied');
      }, 1200);
    } catch {
      btn.textContent = 'Failed';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
    }
  });
  headerEl.appendChild(btn);
}

function createMcpLogElement(entry) {
  const details = document.createElement('details');
  details.className = 'activity-item mcp-log-item';

  const isSuccess = entry.result === 'Success';
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const durationText = entry.duration !== undefined ? `${entry.duration}ms` : '';
  const httpCtx = entry.http;
  const isToolCall = !!entry.tool;

  // Param summary text
  let summaryText = '';
  if (isToolCall) {
    if (entry.params) {
      if (entry.params.command) summaryText = entry.params.command;
      else if (entry.params.path) summaryText = entry.params.path;
      else if (entry.params.skill) summaryText = `${entry.params.skill} (${entry.params.path || 'SKILL.md'})`;
      else summaryText = JSON.stringify(entry.params);
    }
  } else {
    summaryText = `${httpCtx?.url || '/'} (${httpCtx?.ip || '127.0.0.1'})`;
  }

  // Summary row
  const summary = document.createElement('summary');

  // Col 1: Left Fixed Lead
  const lead = document.createElement('div');
  lead.className = 'activity-lead';

  const dot = document.createElement('div');
  dot.className = `activity-dot ${isSuccess ? 'is-success' : 'is-error'}`;
  lead.appendChild(dot);

  if (isToolCall) {
    if (httpCtx) {
      const methodBadge = document.createElement('span');
      const method = (httpCtx.method || 'POST').toUpperCase();
      methodBadge.className = `http-method-badge http-method-${method}`;
      methodBadge.textContent = method;
      lead.appendChild(methodBadge);
    }

    const toolBadge = document.createElement('span');
    const catClass = getToolCategoryClass(entry.tool);
    toolBadge.className = `tool-badge ${catClass}`.trim();
    toolBadge.textContent = entry.tool || 'tool';
    lead.appendChild(toolBadge);
  } else {
    // Pure HTTP request badge
    const methodBadge = document.createElement('span');
    const method = (httpCtx?.method || 'GET').toUpperCase();
    methodBadge.className = `http-method-badge http-method-${method}`;
    methodBadge.textContent = method;
    lead.appendChild(methodBadge);

    const statusBadge = document.createElement('span');
    const status = httpCtx?.status || (isSuccess ? 200 : 500);
    const statusGroup = status >= 500 ? '5xx' : (status >= 400 ? '4xx' : (status >= 300 ? '3xx' : '2xx'));
    statusBadge.className = `http-status-badge http-status-${statusGroup}`;
    statusBadge.textContent = String(status);
    lead.appendChild(statusBadge);
  }

  // Col 2: Middle Fluid Body (Summary / Command / Path)
  const body = document.createElement('div');
  body.className = 'activity-body';

  const summarySpan = document.createElement('span');
  summarySpan.className = 'activity-summary-text';
  summarySpan.textContent = summaryText;
  body.appendChild(summarySpan);

  // Col 3: Right Fixed Trail (Duration + Timestamp + Chevron)
  const trail = document.createElement('div');
  trail.className = 'activity-trail';

  if (durationText) {
    const durationPill = document.createElement('span');
    durationPill.className = 'duration-pill';
    durationPill.textContent = durationText;
    trail.appendChild(durationPill);
  }

  const timeEl = document.createElement('time');
  timeEl.className = 'activity-time';
  timeEl.textContent = time;
  trail.appendChild(timeEl);

  const chevron = document.createElement('div');
  chevron.className = 'activity-chevron';
  chevron.textContent = '▶';
  trail.appendChild(chevron);

  summary.appendChild(lead);
  summary.appendChild(body);
  summary.appendChild(trail);

  // Details panel
  const panel = document.createElement('div');
  panel.className = 'activity-details-panel';

  // Section 0: Inbound HTTP Context (Standard Code Block)
  if (httpCtx) {
    const httpSection = document.createElement('div');
    const httpHeader = document.createElement('div');
    httpHeader.className = 'detail-section-header';

    const httpTitle = document.createElement('span');
    httpTitle.className = 'detail-section-title';
    httpTitle.textContent = 'Inbound HTTP Context';
    httpHeader.appendChild(httpTitle);

    const httpPayload = {
      method: httpCtx.method || 'POST',
      url: httpCtx.url || '/mcp',
      status: httpCtx.status || (isSuccess ? 200 : 500),
      clientIp: httpCtx.ip || '127.0.0.1',
      auth: httpCtx.auth || 'None',
      requestId: httpCtx.requestId || ''
    };
    if (httpCtx.userAgent) httpPayload.userAgent = httpCtx.userAgent;
    if (httpCtx.query) httpPayload.query = httpCtx.query;
    if (httpCtx.headers) httpPayload.headers = httpCtx.headers;

    const httpText = JSON.stringify(httpPayload, null, 2);
    attachCopyButton(httpHeader, httpText);
    httpSection.appendChild(httpHeader);

    const httpCode = document.createElement('pre');
    httpCode.className = 'activity-code-block';
    httpCode.textContent = httpText;
    httpSection.appendChild(httpCode);
    panel.appendChild(httpSection);
  }

  // Section 1: Arguments (If tool call)
  if (isToolCall) {
    const argsSection = document.createElement('div');
    const argsHeader = document.createElement('div');
    argsHeader.className = 'detail-section-header';

    const argsTitle = document.createElement('span');
    argsTitle.className = 'detail-section-title';
    argsTitle.textContent = 'Tool Arguments';
    argsHeader.appendChild(argsTitle);

    const paramsText = JSON.stringify(entry.params || {}, null, 2);
    attachCopyButton(argsHeader, paramsText);
    argsSection.appendChild(argsHeader);

    const argsCode = document.createElement('pre');
    argsCode.className = 'activity-code-block';
    argsCode.textContent = paramsText;
    argsSection.appendChild(argsCode);
    panel.appendChild(argsSection);

    // Section 2: Response / Error Output
    const resSection = document.createElement('div');
    const resHeader = document.createElement('div');
    resHeader.className = 'detail-section-header';

    const resTitle = document.createElement('span');
    resTitle.className = 'detail-section-title';
    resTitle.style.color = isSuccess ? 'var(--color-text-tertiary)' : 'var(--red-300)';
    resTitle.textContent = isSuccess ? 'Response Output' : 'Error Detail';
    resHeader.appendChild(resTitle);

    const outText = entry.error || entry.output || '(No response output)';
    attachCopyButton(resHeader, outText);
    resSection.appendChild(resHeader);

    const resCode = document.createElement('pre');
    resCode.className = `activity-code-block ${!isSuccess ? 'is-error' : ''}`.trim();
    resCode.textContent = outText;

    resSection.appendChild(resCode);
    panel.appendChild(resSection);
  }

  details.appendChild(summary);
  details.appendChild(panel);
  return details;
}

function renderMcpLogItem(entry) {
  const mcpEmpty = document.getElementById('activity-empty-state');
  if (mcpEmpty) mcpEmpty.remove();
  const mcpContainer = document.getElementById('activity-table-container');
  if (mcpContainer) {
    const el = createMcpLogElement(entry);
    if (mcpContainer.firstChild) {
      mcpContainer.insertBefore(el, mcpContainer.firstChild);
    } else {
      mcpContainer.appendChild(el);
    }
    while (mcpContainer.children.length > MAX_DOM_LOG_ITEMS) {
      mcpContainer.lastElementChild?.remove();
    }
  }
}

function createTunnelLogElement(entry) {
  const details = document.createElement('details');
  details.className = 'activity-item tunnel-log-item';

  const level = (entry.level || 'info').toLowerCase();
  const isErr = level === 'error';
  const isWarn = level === 'warn';
  const time = new Date(entry.timestamp).toLocaleTimeString();

  // Summary row: Lead (Fixed) + Body (Fluid) + Trail (Fixed)
  const summary = document.createElement('summary');

  const lead = document.createElement('div');
  lead.className = 'activity-lead';

  const dot = document.createElement('div');
  dot.className = `activity-dot ${isErr ? 'is-error' : (isWarn ? 'is-warn' : 'is-success')}`;
  lead.appendChild(dot);

  const levelBadge = document.createElement('span');
  levelBadge.className = `tunnel-level-badge tunnel-level-${level}`;
  levelBadge.textContent = level.toUpperCase();
  lead.appendChild(levelBadge);

  const body = document.createElement('div');
  body.className = 'activity-body';

  const msgSpan = document.createElement('span');
  msgSpan.className = 'activity-summary-text';
  msgSpan.textContent = entry.message || '';
  body.appendChild(msgSpan);

  const trail = document.createElement('div');
  trail.className = 'activity-trail';

  const timeEl = document.createElement('time');
  timeEl.className = 'activity-time';
  timeEl.textContent = time;
  trail.appendChild(timeEl);

  const chevron = document.createElement('div');
  chevron.className = 'activity-chevron';
  chevron.textContent = '▶';
  trail.appendChild(chevron);

  summary.appendChild(lead);
  summary.appendChild(body);
  summary.appendChild(trail);

  // Details panel
  const panel = document.createElement('div');
  panel.className = 'activity-details-panel';

  const detailText = entry.detail ? JSON.stringify(entry.detail, null, 2) : (entry.message || '(No extra details)');

  const detailSection = document.createElement('div');
  const detailHeader = document.createElement('div');
  detailHeader.className = 'detail-section-header';

  const detailTitle = document.createElement('span');
  detailTitle.className = 'detail-section-title';
  detailTitle.textContent = 'Event Details';
  detailHeader.appendChild(detailTitle);

  attachCopyButton(detailHeader, detailText);
  detailSection.appendChild(detailHeader);

  const detailCode = document.createElement('pre');
  detailCode.className = `activity-code-block ${isErr ? 'is-error' : ''}`.trim();
  detailCode.textContent = detailText;
  detailSection.appendChild(detailCode);

  panel.appendChild(detailSection);
  details.appendChild(summary);
  details.appendChild(panel);
  return details;
}

function renderTunnelLogItem(entry) {
  const emptyState = document.getElementById('tunnel-empty-state');
  if (emptyState) emptyState.remove();

  const container = document.getElementById('tunnel-table-container');
  if (!container) return;

  const details = createTunnelLogElement(entry);
  if (container.firstChild) {
    container.insertBefore(details, container.firstChild);
  } else {
    container.appendChild(details);
  }
  while (container.children.length > MAX_DOM_LOG_ITEMS) {
    container.lastElementChild?.remove();
  }
}

function createRuntimeLogElement(entry) {
  const details = document.createElement('details');
  details.className = 'activity-item runtime-log-item';

  const level = (entry.level || 'info').toLowerCase();
  const isErr = level === 'error';
  const isWarn = level === 'warn';
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const source = entry.source || 'App';

  // Summary row: Lead (Fixed) + Body (Fluid) + Trail (Fixed)
  const summary = document.createElement('summary');

  const lead = document.createElement('div');
  lead.className = 'activity-lead';

  const dot = document.createElement('div');
  dot.className = `activity-dot ${isErr ? 'is-error' : (isWarn ? 'is-warn' : 'is-success')}`;
  lead.appendChild(dot);

  const sourceBadge = document.createElement('span');
  sourceBadge.className = `tunnel-level-badge tunnel-level-${level}`;
  sourceBadge.textContent = source.toUpperCase();
  lead.appendChild(sourceBadge);

  const body = document.createElement('div');
  body.className = 'activity-body';

  const msgSpan = document.createElement('span');
  msgSpan.className = 'activity-summary-text';
  msgSpan.textContent = entry.message || '';
  body.appendChild(msgSpan);

  const trail = document.createElement('div');
  trail.className = 'activity-trail';

  const timeEl = document.createElement('time');
  timeEl.className = 'activity-time';
  timeEl.textContent = time;
  trail.appendChild(timeEl);

  const chevron = document.createElement('div');
  chevron.className = 'activity-chevron';
  chevron.textContent = '▶';
  trail.appendChild(chevron);

  summary.appendChild(lead);
  summary.appendChild(body);
  summary.appendChild(trail);

  // Details panel
  const panel = document.createElement('div');
  panel.className = 'activity-details-panel';

  const detailText = entry.detail ? JSON.stringify(entry.detail, null, 2) : (entry.message || '(No extra details)');

  const detailSection = document.createElement('div');
  const detailHeader = document.createElement('div');
  detailHeader.className = 'detail-section-header';

  const detailTitle = document.createElement('span');
  detailTitle.className = 'detail-section-title';
  detailTitle.textContent = 'Runtime Details';
  detailHeader.appendChild(detailTitle);

  attachCopyButton(detailHeader, detailText);
  detailSection.appendChild(detailHeader);

  const detailCode = document.createElement('pre');
  detailCode.className = `activity-code-block ${isErr ? 'is-error' : ''}`.trim();
  detailCode.textContent = detailText;
  detailSection.appendChild(detailCode);

  panel.appendChild(detailSection);
  details.appendChild(summary);
  details.appendChild(panel);
  return details;
}

function renderRuntimeLogItem(entry) {
  const emptyState = document.getElementById('runtime-empty-state');
  if (emptyState) emptyState.remove();

  const container = document.getElementById('runtime-table-container');
  if (!container) return;

  const details = createRuntimeLogElement(entry);
  if (container.firstChild) {
    container.insertBefore(details, container.firstChild);
  } else {
    container.appendChild(details);
  }
  while (container.children.length > MAX_DOM_LOG_ITEMS) {
    container.lastElementChild?.remove();
  }
}

function renderRecentMcpLogs() {
  const mcpContainer = document.getElementById('activity-table-container');
  if (!mcpContainer) return;
  mcpContainer.replaceChildren();
  if (mcpLogs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'activity-empty';
    empty.id = 'activity-empty-state';
    empty.textContent = 'Waiting for AI assistant MCP requests...';
    mcpContainer.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  const slice = mcpLogs.slice(-MAX_DOM_LOG_ITEMS).reverse();
  for (const entry of slice) {
    fragment.appendChild(createMcpLogElement(entry));
  }
  mcpContainer.appendChild(fragment);
}

function renderRecentTunnelLogs() {
  const container = document.getElementById('tunnel-table-container');
  if (!container) return;
  container.replaceChildren();
  if (tunnelLogs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'activity-empty';
    empty.id = 'tunnel-empty-state';
    empty.textContent = 'Waiting for tunnel events...';
    container.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  const slice = tunnelLogs.slice(-MAX_DOM_LOG_ITEMS).reverse();
  for (const entry of slice) {
    fragment.appendChild(createTunnelLogElement(entry));
  }
  container.appendChild(fragment);
}

function renderRecentRuntimeLogs() {
  const container = document.getElementById('runtime-table-container');
  if (!container) return;
  container.replaceChildren();
  if (runtimeLogs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'activity-empty';
    empty.id = 'runtime-empty-state';
    empty.textContent = 'Waiting for runtime events...';
    container.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  const slice = runtimeLogs.slice(-MAX_DOM_LOG_ITEMS).reverse();
  for (const entry of slice) {
    fragment.appendChild(createRuntimeLogElement(entry));
  }
  container.appendChild(fragment);
}

// Redact sensitive patterns for Safe Log export (tokens, keys, secrets)
function redactSafeText(text) {
  return String(text ?? '')
    .replace(/mcp_[ar]t_[A-Za-z0-9_-]{20,}/g, '[mcp-token-redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{20,}\b/gi, 'Bearer [redacted]')
    .replace(/\/Users\/[^\/\s"']+/g, '/Users/[username]')
    .replace(/C:\\Users\\[^\/\s"'\\]+/g, 'C:\\Users\\[username]');
}

// --- Export & Clear Buttons ---
async function exportSafeLog() {
  const exportBtn = document.getElementById('export-safe-log-btn');
  const safeJsonParse = (str, fallback = null) => {
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  };

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    mcpRequests: mcpLogs.map(l => ({
      ...l,
      params: safeJsonParse(redactSafeText(JSON.stringify(l.params || {})), l.params),
      output: redactSafeText(l.output || ''),
      error: redactSafeText(l.error || ''),
      http: l.http ? {
        ...l.http,
        url: redactSafeText(l.http.url),
        ip: redactSafeText(l.http.ip)
      } : null
    })),
    tunnelLogs: tunnelLogs.map(l => ({
      ...l,
      message: redactSafeText(l.message),
      detail: l.detail ? safeJsonParse(redactSafeText(JSON.stringify(l.detail)), l.detail) : null
    })),
    appRuntimeLogs: runtimeLogs.map(l => ({
      ...l,
      message: redactSafeText(l.message),
      detail: l.detail ? safeJsonParse(redactSafeText(JSON.stringify(l.detail)), l.detail) : null
    }))
  };

  try {
    await navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
    if (exportBtn) {
      const originalText = exportBtn.textContent;
      exportBtn.textContent = 'Copied ✓';
      exportBtn.classList.add('btn-success');
      setTimeout(() => {
        exportBtn.textContent = originalText;
        exportBtn.classList.remove('btn-success');
      }, 1400);
    }
  } catch (err) {
    console.error('Failed to export log to clipboard:', err);
    if (exportBtn) {
      const originalText = exportBtn.textContent;
      exportBtn.textContent = 'Copy Failed';
      setTimeout(() => {
        exportBtn.textContent = originalText;
      }, 1400);
    }
  }
}

async function clearAllLogs() {
  const clearBtn = document.getElementById('clear-all-logs-btn');
  mcpLogs.length = 0;
  tunnelLogs.length = 0;
  runtimeLogs.length = 0;
  pendingLogsRender.mcp = false;
  pendingLogsRender.tunnel = false;
  pendingLogsRender.runtime = false;

  const tableContainer = document.getElementById('activity-table-container');
  if (tableContainer) {
    tableContainer.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'activity-empty';
    empty.id = 'activity-empty-state';
    empty.textContent = 'Logs cleared. Waiting for new activity...';
    tableContainer.appendChild(empty);
  }

  const tunnelContainer = document.getElementById('tunnel-table-container');
  if (tunnelContainer) {
    tunnelContainer.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'activity-empty';
    empty.id = 'tunnel-empty-state';
    empty.textContent = 'Tunnel logs cleared.';
    tunnelContainer.appendChild(empty);
  }

  const runtimeContainer = document.getElementById('runtime-table-container');
  if (runtimeContainer) {
    runtimeContainer.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'activity-empty';
    empty.id = 'runtime-empty-state';
    empty.textContent = 'App runtime logs cleared.';
    runtimeContainer.appendChild(empty);
  }

  try {
    if (window.api && typeof window.api.clearLogs === 'function') {
      await window.api.clearLogs();
    }
  } catch (err) {
    console.error('Failed to clear persisted logs in main process:', err);
  }

  if (clearBtn) {
    const originalText = clearBtn.textContent;
    clearBtn.textContent = 'Cleared ✓';
    clearBtn.classList.add('btn-success');
    setTimeout(() => {
      clearBtn.textContent = originalText;
      clearBtn.classList.remove('btn-success');
    }, 1400);
  }
}

window.exportSafeLog = exportSafeLog;
window.clearAllLogs = clearAllLogs;
