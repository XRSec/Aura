use serde_json::{json, Map, Value};
use std::{fs, io, path::PathBuf};
use uuid::Uuid;

const PROVIDERS: [&str; 4] = ["cloudflare-named", "cloudflare-quick", "openai", "custom"];
const DEFAULT_PROVIDER: &str = "cloudflare-named";

fn create_mcp_path() -> String {
    format!(
        "/{}/mcp",
        format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
    )
}

fn provider_defaults(mode: &str) -> Value {
    json!({
        "mcpUrl": if mode == "openai" { "OpenAI Secure Tunnel (Auth: None)" } else { "https://mcp.yourdomain.com" },
        "mcpPath": create_mcp_path(),
        "cfConfigPath": "",
        "listenHost": "127.0.0.1",
        "listenPort": 3000,
        "tunnelId": "",
        "tunnelApiKey": "",
        "binaryPath": "",
        "sslCertPath": "",
        "sslKeyPath": ""
    })
}

fn instruction_defaults() -> Value {
    let en_basic = [
        "You are connected to the Aura local MCP server.",
        "Prefer Aura's provided MCP tools for local files, commands, and other permitted operations.",
        "If a dedicated tool already supports the task, use it instead of simulating that capability with execute_shell.",
        "When a task matches an available Skill and list_skills/read_skill are enabled, use them to obtain the relevant workflow instructions.",
        "Strictly follow Aura's configured Filesystem Root and Shell Policy. If a tool is unavailable or an operation is blocked, state the reason clearly and do not fabricate execution results."
    ].join("\n");
    let en_pi = [
        "You are connected to the Aura local MCP capability bridge.",
        "Pi Tools selected in Aura Settings are exposed with their schemas and enabled when the MCP session connects; unselected tools are unavailable.",
        "If a dedicated Pi tool can complete the task, call it directly; do not call request_capabilities first.",
        "request_capabilities is mainly for loading Pi Skills on demand; use list_skills/read_skill to read the full SKILL.md and referenced relative files.",
        "Aura executes Pi tools directly and does not call the Pi Agent's session.prompt(); capabilities that may invoke Pi's default model are blocked by default."
    ].join("\n");
    let zh_basic = [
        "你已连接 Aura 本地 MCP 服务器。",
        "优先使用 Aura 已提供的 MCP 工具完成本地文件、命令和其他允许的操作。",
        "如果已有专用工具可以完成任务，优先使用专用工具，不要用 execute_shell 模拟已有能力。",
        "任务匹配可用 Skill 且启用了 list_skills/read_skill 时，可用它们获取对应工作流说明。",
        "严格遵守 Aura 配置的 Filesystem Root 与 Shell Policy；工具不可用或操作被阻止时明确说明原因，不要伪造执行结果。"
    ].join("\n");
    let zh_pi = [
        "你已连接 Aura 本地 MCP 能力桥。",
        "Aura Settings 中勾选的 Pi Tools 会在 MCP 连接时直接暴露 Schema 并启用执行；未勾选的工具不可用。",
        "如果已有专用 Pi 工具可以完成任务，直接调用该工具，不需要先调用 request_capabilities。",
        "request_capabilities 主要用于按需加载 Pi Skills；可用 list_skills/read_skill 读取完整 SKILL.md 及其相对引用文件。",
        "Aura 只直接执行 Pi 工具，不调用 Pi Agent 的 session.prompt()；默认阻止可能调用 Pi 默认模型的能力。"
    ].join("\n");
    json!({
        "en": { "basic": en_basic, "pi": en_pi },
        "zh-CN": { "basic": zh_basic, "pi": zh_pi }
    })
}

fn default_config() -> Value {
    let defaults = instruction_defaults();
    let mut providers = Map::new();
    for mode in PROVIDERS {
        providers.insert(mode.to_string(), provider_defaults(mode));
    }
    json!({
        "tunnelMode": DEFAULT_PROVIDER,
        "autoConnect": true,
        "debugMode": false,
        "language": "en",
        "appearance": "dark",
        "mcpInstructions": defaults["en"]["basic"],
        "defaultCapabilitiesEnabled": true,
        "defaultTools": ["read_file", "write_file", "execute_shell", "list_skills", "read_skill"],
        "piEnabled": false,
        "piTools": [],
        "piAllowModelTools": false,
        "fsRoot": "~/",
        "shellPolicy": "unrestricted",
        "shellAllowlist": [],
        "shellDenylist": [],
        "tokenValidity": "24h",
        "providerConfigs": Value::Object(providers)
    })
}

pub fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
        .join("Aura")
        .join("aura-config.json")
}

fn merge_missing(target: &mut Value, defaults: &Value) {
    let (Some(target), Some(defaults)) = (target.as_object_mut(), defaults.as_object()) else {
        return;
    };
    for (key, default_value) in defaults {
        match target.get_mut(key) {
            Some(current) if current.is_object() && default_value.is_object() => {
                merge_missing(current, default_value)
            }
            Some(_) => {}
            None => {
                target.insert(key.clone(), default_value.clone());
            }
        }
    }
}

pub fn load() -> Value {
    let defaults = default_config();
    let path = config_path();
    let existed = path.exists();
    let mut config = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| defaults.clone());
    let before = config.clone();
    merge_missing(&mut config, &defaults);
    if !existed || config != before {
        let _ = write(&config);
    }
    config
}

pub fn write(config: &Value) -> io::Result<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(config).map_err(io::Error::other)?;
    fs::write(path, bytes)
}

fn provider_mode(config: &Value, requested: Option<&str>) -> String {
    let candidate = requested
        .or_else(|| config.get("tunnelMode").and_then(Value::as_str))
        .unwrap_or(DEFAULT_PROVIDER);
    if PROVIDERS.contains(&candidate) {
        candidate.to_string()
    } else {
        DEFAULT_PROVIDER.to_string()
    }
}

pub fn effective(config: &Value, requested: Option<&str>) -> Value {
    let mode = provider_mode(config, requested);
    let mut result = config.clone();
    if let Some(object) = result.as_object_mut() {
        object.insert("tunnelMode".into(), Value::String(mode.clone()));
        if let Some(provider) = config
            .pointer(&format!("/providerConfigs/{mode}"))
            .and_then(Value::as_object)
        {
            for (key, value) in provider {
                object.insert(key.clone(), value.clone());
            }
        }
        object.insert("mcpInstructionDefaults".into(), {
            let language = config
                .get("language")
                .and_then(Value::as_str)
                .unwrap_or("en");
            instruction_defaults()
                .get(language)
                .cloned()
                .unwrap_or_else(|| instruction_defaults()["en"].clone())
        });
        object.insert("defaultCapabilitiesCatalog".into(), json!([
            {"name":"read_file","description":"Read a UTF-8 file inside Aura Filesystem Root."},
            {"name":"write_file","description":"Create or overwrite a UTF-8 file inside Aura Filesystem Root."},
            {"name":"execute_shell","description":"Execute a shell command under Aura Shell Policy."},
            {"name":"list_skills","description":"List reusable Skills available to Aura."},
            {"name":"read_skill","description":"Read SKILL.md or another file inside a selected Skill."}
        ]));
    }
    result
}

pub fn update(mut config: Value, payload: &Value) -> Value {
    let requested_mode = payload.get("tunnelMode").and_then(Value::as_str);
    let mode = provider_mode(&config, requested_mode);

    const GLOBAL_KEYS: [&str; 14] = [
        "tunnelMode",
        "autoConnect",
        "debugMode",
        "language",
        "appearance",
        "mcpInstructions",
        "defaultCapabilitiesEnabled",
        "defaultTools",
        "piEnabled",
        "piTools",
        "piAllowModelTools",
        "fsRoot",
        "shellPolicy",
        "tokenValidity",
    ];
    const PROVIDER_KEYS: [&str; 9] = [
        "mcpUrl",
        "mcpPath",
        "cfConfigPath",
        "listenHost",
        "listenPort",
        "tunnelId",
        "tunnelApiKey",
        "binaryPath",
        "sslCertPath",
    ];

    if let (Some(root), Some(changes)) = (config.as_object_mut(), payload.as_object()) {
        for key in GLOBAL_KEYS {
            if let Some(value) = changes.get(key) {
                root.insert(key.to_string(), value.clone());
            }
        }
        for key in ["shellAllowlist", "shellDenylist"] {
            if let Some(value) = changes.get(key) {
                root.insert(key.to_string(), value.clone());
            }
        }
        if let Some(providers) = root
            .get_mut("providerConfigs")
            .and_then(Value::as_object_mut)
        {
            let provider = providers
                .entry(mode.clone())
                .or_insert_with(|| provider_defaults(&mode));
            if let Some(provider_object) = provider.as_object_mut() {
                for key in PROVIDER_KEYS {
                    if let Some(value) = changes.get(key) {
                        provider_object.insert(key.to_string(), value.clone());
                    }
                }
                if let Some(value) = changes.get("sslKeyPath") {
                    provider_object.insert("sslKeyPath".to_string(), value.clone());
                }
            }
        }
    }
    config
}

pub fn update_provider(mut config: Value, mode: &str, updates: &Value) -> Value {
    let mode = provider_mode(&config, Some(mode));
    if let (Some(root), Some(changes)) = (config.as_object_mut(), updates.as_object()) {
        if let Some(providers) = root
            .get_mut("providerConfigs")
            .and_then(Value::as_object_mut)
        {
            let provider = providers
                .entry(mode.clone())
                .or_insert_with(|| provider_defaults(&mode));
            if let Some(provider) = provider.as_object_mut() {
                for (key, value) in changes {
                    provider.insert(key.clone(), value.clone());
                }
            }
        }
    }
    config
}
