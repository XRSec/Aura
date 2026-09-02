const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');

const PROVIDERS = ['cloudflare-named', 'cloudflare-quick', 'openai', 'custom'];
const DEFAULT_PROVIDER = 'cloudflare-named';
const SHELL_POLICIES = ['unrestricted', 'allowlist', 'denylist'];
const DEFAULT_SHELL_POLICY = 'unrestricted';
const UI_LANGUAGES = ['en', 'zh-CN'];
const UI_APPEARANCES = ['dark', 'light'];

const DEFAULT_CAPABILITY_CATALOG = [
  { name: 'read_file', description: 'Read a UTF-8 file inside Aura Filesystem Root.' },
  { name: 'write_file', description: 'Create or overwrite a UTF-8 file inside Aura Filesystem Root.' },
  { name: 'execute_shell', description: 'Execute a shell command under Aura Shell Policy.' },
  { name: 'list_skills', description: 'List reusable Skills available to Aura.' },
  { name: 'read_skill', description: 'Read SKILL.md or another file inside a selected Skill.' }
];
const DEFAULT_CAPABILITY_NAMES = DEFAULT_CAPABILITY_CATALOG.map(item => item.name);
const DEFAULT_MCP_INSTRUCTIONS_EN = {
  basic: [
    'You are connected to the Aura local MCP server.',
    "Prefer Aura's provided MCP tools for local files, commands, and other permitted operations.",
    'If a dedicated tool already supports the task, use it instead of simulating that capability with execute_shell.',
    'When a task matches an available Skill and list_skills/read_skill are enabled, use them to obtain the relevant workflow instructions.',
    "Strictly follow Aura's configured Filesystem Root and Shell Policy. If a tool is unavailable or an operation is blocked, state the reason clearly and do not fabricate execution results."
  ].join('\n'),
  pi: [
    'You are connected to the Aura local MCP capability bridge.',
    'Pi Tools selected in Aura Settings are exposed with their schemas and enabled when the MCP session connects; unselected tools are unavailable.',
    'If a dedicated Pi tool can complete the task, call it directly; do not call request_capabilities first.',
    'request_capabilities is mainly for loading Pi Skills on demand; use list_skills/read_skill to read the full SKILL.md and referenced relative files.',
    "Aura executes Pi tools directly and does not call the Pi Agent's session.prompt(); capabilities that may invoke Pi's default model are blocked by default."
  ].join('\n')
};

const DEFAULT_MCP_INSTRUCTIONS_ZH = {
  basic: [
    '你已连接 Aura 本地 MCP 服务器。',
    '优先使用 Aura 已提供的 MCP 工具完成本地文件、命令和其他允许的操作。',
    '如果已有专用工具可以完成任务，优先使用专用工具，不要用 execute_shell 模拟已有能力。',
    '任务匹配可用 Skill 且启用了 list_skills/read_skill 时，可用它们获取对应工作流说明。',
    '严格遵守 Aura 配置的 Filesystem Root 与 Shell Policy；工具不可用或操作被阻止时明确说明原因，不要伪造执行结果。'
  ].join('\n'),
  pi: [
    '你已连接 Aura 本地 MCP 能力桥。',
    'Aura Settings 中勾选的 Pi Tools 会在 MCP 连接时直接暴露 Schema 并启用执行；未勾选的工具不可用。',
    '如果已有专用 Pi 工具可以完成任务，直接调用该工具，不需要先调用 request_capabilities。',
    'request_capabilities 主要用于按需加载 Pi Skills；可用 list_skills/read_skill 读取完整 SKILL.md 及其相对引用文件。',
    'Aura 只直接执行 Pi 工具，不调用 Pi Agent 的 session.prompt()；默认阻止可能调用 Pi 默认模型的能力。'
  ].join('\n')
};

function getMcpInstructionDefaults(language = 'en') {
  return language === 'zh-CN' ? DEFAULT_MCP_INSTRUCTIONS_ZH : DEFAULT_MCP_INSTRUCTIONS_EN;
}

function isAuraDefaultMcpInstructions(value) {
  return value === DEFAULT_MCP_INSTRUCTIONS_EN.basic
    || value === DEFAULT_MCP_INSTRUCTIONS_EN.pi
    || value === DEFAULT_MCP_INSTRUCTIONS_ZH.basic
    || value === DEFAULT_MCP_INSTRUCTIONS_ZH.pi
    || value === LEGACY_DEFAULT_MCP_INSTRUCTIONS_PI
    || value === LEGACY_CHATGPT_REFRESH_MCP_INSTRUCTIONS_PI
    || value === LEGACY_EXPOSURE_MCP_INSTRUCTIONS_PI;
}
const LEGACY_EXPOSURE_MCP_INSTRUCTIONS_PI = [
  '你已连接 Aura 本地 MCP 能力桥。',
  'Aura Settings 中选中的 Pi Tools 是允许暴露的能力；Default-enabled Tools 会在每个 MCP 会话连接时直接启用。',
  'Compatibility Mode 会在连接时暴露全部选中工具的 Schema；未启用工具仍需先调用 request_capabilities，再执行该工具。',
  'Dynamic Mode 只暴露当前已启用工具；request_capabilities 启用后通过 MCP notifications/tools/list_changed 刷新工具列表，要求客户端支持运行时工具刷新。',
  '如果用户明确指定某个尚未启用的 Pi tool 或 Skill，先调用 request_capabilities 激活该能力，不要用 execute_shell 或其他工具模拟它。',
  '需要专用工作流时，可用 list_skills/read_skill 读取完整 SKILL.md 及其相对引用文件。',
  'Aura 只直接执行 Pi 工具，不调用 Pi Agent 的 session.prompt()；默认阻止可能调用 Pi 默认模型的能力。'
].join('\n');
const LEGACY_CHATGPT_REFRESH_MCP_INSTRUCTIONS_PI = [
  '你已连接 Aura 本地 MCP 能力桥。',
  '核心工具可直接使用；Pi 的其他工具和 Skills 按需通过 request_capabilities 激活。',
  '如果用户明确指定某个尚未激活的 Pi tool 或 Skill，先调用 request_capabilities 激活该能力，不要用 execute_shell 或其他工具模拟它。',
  '需要专用工作流时，根据 request_capabilities 的能力目录选择 Skill；可用 read_skill 读取完整 SKILL.md 及其相对引用文件。',
  'Pi 工具激活后，Aura 会发送 MCP notifications/tools/list_changed；支持运行时工具刷新客户端可直接使用新增工具。ChatGPT Custom App 使用已扫描的 action 快照，新增工具需要在 Apps 设置中 Refresh 后才能出现。',
  'Aura 只直接执行 Pi 工具，不调用 Pi Agent 的 session.prompt()；默认阻止可能调用 Pi 默认模型的能力。'
].join('\n');
const LEGACY_DEFAULT_MCP_INSTRUCTIONS_PI = [
  '你已连接 Aura 本地 MCP 能力桥。',
  '核心工具可直接使用；Pi 的其他工具和 Skills 按需通过 request_capabilities 激活。',
  '如果用户明确指定某个尚未激活的 Pi tool 或 Skill，先调用 request_capabilities 激活该能力，不要用 execute_shell 或其他工具模拟它。',
  '需要专用工作流时，根据 request_capabilities 的能力目录选择 Skill；可用 read_skill 读取完整 SKILL.md 及其相对引用文件。',
  'Pi 工具激活后会通过 MCP tools/list_changed 动态加入当前会话，再直接调用该工具。',
  'Aura 只直接执行 Pi 工具，不调用 Pi Agent 的 session.prompt()；默认阻止可能调用 Pi 默认模型的能力。'
].join('\n');

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
      language: 'en',
      appearance: 'dark',
      mcpInstructions: DEFAULT_MCP_INSTRUCTIONS_EN.basic,
      defaultCapabilitiesEnabled: true,
      defaultTools: [...DEFAULT_CAPABILITY_NAMES],
      piEnabled: false,
      piTools: [],
      piAllowModelTools: false,
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
    const language = UI_LANGUAGES.includes(stored.language) ? stored.language : 'en';
    const appearance = UI_APPEARANCES.includes(stored.appearance) ? stored.appearance : 'dark';
    if (stored.language !== language || stored.appearance !== appearance) {
      needsSave = true;
    }
    if (typeof stored.piAllowModelTools !== 'boolean') {
      needsSave = true;
    }
    if (typeof stored.mcpInstructions !== 'string' || typeof stored.piEnabled !== 'boolean' || !Array.isArray(stored.piTools)) {
      needsSave = true;
    }
    if (typeof stored.defaultCapabilitiesEnabled !== 'boolean' || !Array.isArray(stored.defaultTools)) {
      needsSave = true;
    }

    const defaultTools = Array.isArray(stored.defaultTools)
      ? [...new Set(stored.defaultTools.filter(name => DEFAULT_CAPABILITY_NAMES.includes(name)))]
      : [...DEFAULT_CAPABILITY_NAMES];
    const piTools = Array.isArray(stored.piTools)
      ? [...new Set(stored.piTools.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()))]
      : [];
    const piEnabled = stored.piEnabled === true;
    const localizedMcpDefaults = getMcpInstructionDefaults(language);
    let mcpInstructions = typeof stored.mcpInstructions === 'string'
      ? stored.mcpInstructions
      : (piEnabled ? localizedMcpDefaults.pi : localizedMcpDefaults.basic);
    // Keep Aura-owned defaults aligned with the selected UI language without touching user-customized prompts.
    if (isAuraDefaultMcpInstructions(mcpInstructions)) {
      const localizedDefault = piEnabled ? localizedMcpDefaults.pi : localizedMcpDefaults.basic;
      if (mcpInstructions !== localizedDefault) {
        mcpInstructions = localizedDefault;
        needsSave = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(stored, 'piToolExposureMode') || Object.prototype.hasOwnProperty.call(stored, 'piDefaultTools')) {
      delete stored.piToolExposureMode;
      delete stored.piDefaultTools;
      needsSave = true;
    }

    const finalConfig = {
      ...this.defaultConfig,
      ...stored,
      shellPolicy,
      language,
      appearance,
      providerConfigs,
      fsRoot: stored.fsRoot ?? '~/',
      mcpInstructions,
      defaultCapabilitiesEnabled: stored.defaultCapabilitiesEnabled !== false,
      defaultTools,
      piEnabled,
      piTools,
      piAllowModelTools: stored.piAllowModelTools === true
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
    if (globalConfig.language && !UI_LANGUAGES.includes(globalConfig.language)) {
      delete globalConfig.language;
    }
    if (globalConfig.appearance && !UI_APPEARANCES.includes(globalConfig.appearance)) {
      delete globalConfig.appearance;
    }
    if (Array.isArray(globalConfig.defaultTools)) {
      globalConfig.defaultTools = [...new Set(globalConfig.defaultTools.filter(name => DEFAULT_CAPABILITY_NAMES.includes(name)))];
    }
    if (Array.isArray(globalConfig.piTools)) {
      globalConfig.piTools = [...new Set(globalConfig.piTools.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()))];
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
      providerConfigs: this.config.providerConfigs,
      mcpInstructionDefaults: getMcpInstructionDefaults(this.config.language),
      defaultCapabilitiesCatalog: DEFAULT_CAPABILITY_CATALOG
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
    const nextLanguage = UI_LANGUAGES.includes(payload.language) ? payload.language : this.config.language;
    const nextPiEnabled = typeof payload.piEnabled === 'boolean' ? payload.piEnabled : this.config.piEnabled;
    const syncAuraDefaultInstructions = payload.mcpInstructions === undefined
      && isAuraDefaultMcpInstructions(this.config.mcpInstructions);
    if (UI_LANGUAGES.includes(payload.language)) {
      this.config.language = nextLanguage;
    }
    if (UI_APPEARANCES.includes(payload.appearance)) {
      this.config.appearance = payload.appearance;
    }
    if (typeof payload.piEnabled === 'boolean') {
      this.config.piEnabled = nextPiEnabled;
    }
    if (typeof payload.mcpInstructions === 'string') {
      this.config.mcpInstructions = payload.mcpInstructions;
    } else if (syncAuraDefaultInstructions) {
      const localizedDefaults = getMcpInstructionDefaults(nextLanguage);
      this.config.mcpInstructions = nextPiEnabled ? localizedDefaults.pi : localizedDefaults.basic;
    }
    if (typeof payload.defaultCapabilitiesEnabled === 'boolean') {
      this.config.defaultCapabilitiesEnabled = payload.defaultCapabilitiesEnabled;
    }
    if (Array.isArray(payload.defaultTools)) {
      this.config.defaultTools = [...new Set(payload.defaultTools.filter(name => DEFAULT_CAPABILITY_NAMES.includes(name)))];
    }
    if (Array.isArray(payload.piTools)) {
      this.config.piTools = [...new Set(payload.piTools.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()))];
    }
    if (typeof payload.piAllowModelTools === 'boolean') {
      this.config.piAllowModelTools = payload.piAllowModelTools;
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
