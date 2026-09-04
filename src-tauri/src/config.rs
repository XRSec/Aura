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
        "You are connected to the Aura local MCP server. This provides you with capabilities to interact with the local filesystem, execute shell commands, and access local Skills.",
        "Please follow these principles:",
        "1. Prefer dedicated tools: Always use specific tools like read_file or write_file when available, rather than simulating them via execute_shell (e.g. using cat or echo).",
        "2. Respect security boundaries: Strictly follow the configured Filesystem Root and Shell Policy. If an operation is blocked or rejected, state the reason truthfully and never fabricate success.",
        "3. Leverage Skills: If a task matches a specific domain and list_skills/read_skill are enabled, use them to read the SKILL.md and understand the required workflow constraints.",
        "4. Transparent feedback: If a tool or command fails, carefully read the stderr or error message, and either attempt to fix the root cause or ask for clarification. Do not blindly retry failing commands."
    ].join("\n");
    let en_pi = [
        "You are connected to the Aura-Pi local MCP hybrid capability engine. In addition to basic file and shell operations, you now have access to Pi Coding Agent's advanced AST-aware tools, LSP, cross-file refactoring, and complex workflows.",
        "Please strictly adhere to the following execution rules:",
        "1. Direct tool usage: All Pi Tools selected in Aura Settings have their schemas directly available in this context. You must call them directly; DO NOT call request_capabilities first.",
        "2. On-demand discovery: request_capabilities is reserved only for activating special underlying skill sets on demand. To understand project conventions, use list_skills and read_skill to read relevant documentation first.",
        "3. Semantic search first: For code exploration, prioritize semantic and AST-level tools (e.g., symbol_search, ast_grep_search, module_report) over fragile plain-text searches.",
        "4. No inception / agent nesting: Aura only bridges local tool execution and will not invoke external Pi models or initiate secondary session.prompt() loops for you. You must drive the reasoning yourself.",
        "5. Precise editing: When modifying code, use the `edit` or AST refactoring tools for targeted replacements to avoid overwriting entire large files. Use lsp_diagnostics to catch errors before building."
    ].join("\n");
    let zh_basic = [
        "你已连接 Aura 本地 MCP 服务器。这为你提供了直接操作本地宿主机文件系统、执行 Shell 命令、以及访问本地技能字典（Skills）的能力。",
        "在与我交互时，请遵循以下原则：",
        "1. 优先使用专用工具：如果存在针对性的操作工具（如 read_file, write_file 等），请直接使用，不要尝试通过 execute_shell 使用诸如 cat/echo/sed 来绕过。",
        "2. 遵守安全边界：严格遵守已配置的 Filesystem Root 与 Shell Policy 限制。当操作越界被拒绝时，请如实告知我原因，绝不伪造执行结果。",
        "3. 善用技能系统：当我的诉求与某项业务或开发流强相关时，如果有 list_skills/read_skill 能力，你可以先调用它们以加载相关的上下文与执行规范 (SKILL.md)。",
        "4. 透明反馈：如果遇到命令执行失败或文件不存在，请仔细阅读返回的 stderr 或错误信息，并根据错误提示尝试修正或向我确认，不要盲目重试相同的错误操作。"
    ].join("\n");
    let zh_pi = [
        "你已完全接入 Aura-Pi 本地 MCP 混合能力引擎。除了基础的文件与终端操作外，你现在拥有了 Pi Coding Agent 的高级 AST 感知、语言服务器 (LSP)、跨文件重构及复杂工作流委派能力。",
        "请严格遵守以下执行规范：",
        "1. 直接调用可用工具：所有在 Aura 设置中勾选的 Pi Tools，其 Schema 已在当前上下文中直接可用。你可以直接调用它们，不需要（也不应该）先调用 request_capabilities。",
        "2. 按需发现与加载：request_capabilities 工具仅保留用于按需激活特殊的底层技能组合。如需深入理解某个项目的代码库规约，请先使用 list_skills / read_skill 阅读相应的技能说明文档。",
        "3. 语义搜索优先：进行代码搜索时，优先使用语义和 AST 级工具（如 symbol_search, ast_grep_search, module_report 等）来替代脆弱的纯文本搜索。",
        "4. 禁止循环套娃：Aura 仅负责本地工具的执行桥接，不会替你调用外部的 Pi 模型或发起次级 session.prompt() 会话。你必须自己完成思考并决策，不能试图通过触发 Pi 默认模型工具把任务外包出去。",
        "5. 精准编辑：当需要修改代码时，优先使用 edit 或 AST 重构工具进行局部精准替换，避免每次修改都覆写整个大文件。在遇到错误时，借助 lsp_diagnostics 在构建前拦截问题。"
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
        "piBinaryPath": "",
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

    const GLOBAL_KEYS: [&str; 15] = [
        "tunnelMode",
        "autoConnect",
        "debugMode",
        "language",
        "appearance",
        "mcpInstructions",
        "defaultCapabilitiesEnabled",
        "defaultTools",
        "piEnabled",
        "piBinaryPath",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_persists_pi_binary_path() {
        let updated = update(
            default_config(),
            &json!({"piBinaryPath": "/tmp/custom-pi/bin/pi"}),
        );
        assert_eq!(
            updated.get("piBinaryPath").and_then(Value::as_str),
            Some("/tmp/custom-pi/bin/pi")
        );
    }
}
