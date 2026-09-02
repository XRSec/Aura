use crate::config;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex},
};
use uuid::Uuid;

const WORKER_SOURCE: &str = include_str!("../pi-worker.cjs");
const PI_PACKAGE_NAMES: [&str; 2] = [
    "@earendil-works/pi-coding-agent",
    "@mariozechner/pi-coding-agent",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiTool {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "empty_schema")]
    pub parameters: Value,
    #[serde(default)]
    pub source_info: Option<Value>,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub uses_pi_default_model: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSkill {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub file_path: String,
    #[serde(default)]
    pub base_dir: String,
    #[serde(default)]
    pub source_info: Option<Value>,
    #[serde(default)]
    pub disable_model_invocation: bool,
}

fn empty_schema() -> Value {
    json!({"type":"object","properties":{}})
}

struct WorkerInner {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
}

#[derive(Clone)]
pub struct PiBridge {
    inner: Arc<WorkerInner>,
    pub version: String,
    pub node_version: String,
    pub tools: Arc<Vec<PiTool>>,
    pub skills: Arc<Vec<PiSkill>>,
    active_tools: Arc<HashSet<String>>,
    fs_root: PathBuf,
    shell_policy: String,
    shell_allowlist: Arc<HashSet<String>>,
    shell_denylist: Arc<HashSet<String>>,
}

struct PiLocation {
    version: String,
    package_entry: PathBuf,
    node_path: PathBuf,
    node_version: String,
}

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn expand_home(value: &str) -> PathBuf {
    let value = value.trim();
    if value.is_empty() || value == "~" {
        return home_dir();
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    PathBuf::from(value)
}

fn package_manifest(root: &Path) -> Option<Value> {
    fs::read_to_string(root.join("package.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}

fn package_entry(root: &Path, manifest: &Value) -> Option<PathBuf> {
    let export = manifest
        .pointer("/exports/./import")
        .and_then(Value::as_str)
        .or_else(|| manifest.pointer("/exports/.").and_then(Value::as_str))
        .or_else(|| manifest.get("module").and_then(Value::as_str))
        .or_else(|| manifest.get("main").and_then(Value::as_str))?;
    Some(root.join(export))
}

fn package_candidates() -> Vec<PathBuf> {
    let home = home_dir();
    let mut roots = Vec::new();
    if let Some(value) = env::var_os("AURA_PI_PACKAGE") {
        roots.push(PathBuf::from(value));
    }

    let nvm = home.join(".nvm/versions/node");
    if let Ok(entries) = fs::read_dir(&nvm) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            let npm_root = entry.path().join("lib/node_modules");
            for name in PI_PACKAGE_NAMES {
                roots.push(npm_root.join(name));
            }
            roots.push(
                npm_root
                    .join("@agegr/pi-web/node_modules")
                    .join(PI_PACKAGE_NAMES[0]),
            );
        }
    }

    #[cfg(target_os = "windows")]
    if let Some(appdata) = env::var_os("APPDATA") {
        let npm_root = PathBuf::from(appdata).join("npm/node_modules");
        for name in PI_PACKAGE_NAMES {
            roots.push(npm_root.join(name));
        }
    }

    roots
}

async fn global_npm_root() -> Option<PathBuf> {
    let output = Command::new("npm")
        .args(["root", "-g"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!value.is_empty()).then(|| PathBuf::from(value))
}

fn node_candidates(package_root: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let node_name = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };
    let root_text = package_root.to_string_lossy();
    let marker = format!(
        "{}lib{}node_modules{}",
        std::path::MAIN_SEPARATOR,
        std::path::MAIN_SEPARATOR,
        std::path::MAIN_SEPARATOR
    );
    if let Some(index) = root_text.find(&marker) {
        candidates.push(
            PathBuf::from(&root_text[..index])
                .join("bin")
                .join(node_name),
        );
    }
    candidates.extend(
        env::split_paths(&env::var_os("PATH").unwrap_or_default()).map(|dir| dir.join(node_name)),
    );
    let nvm = home_dir().join(".nvm/versions/node");
    if let Ok(entries) = fs::read_dir(nvm) {
        let mut versions = entries
            .flatten()
            .map(|entry| entry.path())
            .collect::<Vec<_>>();
        versions.sort();
        versions.reverse();
        for version in versions {
            candidates.push(version.join("bin").join(node_name));
        }
    }
    candidates
}

fn node_compatible(version: &str) -> bool {
    let parts = version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .filter_map(|part| part.parse::<u64>().ok())
        .collect::<Vec<_>>();
    matches!(parts.as_slice(), [major, minor, ..] if *major > 22 || (*major == 22 && *minor >= 19))
}

async fn inspect_node(path: &Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    let output = Command::new(path)
        .args(["-p", "process.versions.node"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    node_compatible(&version).then_some(version)
}

async fn locate_pi() -> Result<PiLocation, String> {
    let mut candidates = package_candidates();
    if let Some(npm_root) = global_npm_root().await {
        for name in PI_PACKAGE_NAMES {
            candidates.push(npm_root.join(name));
        }
        candidates.push(
            npm_root
                .join("@agegr/pi-web/node_modules")
                .join(PI_PACKAGE_NAMES[0]),
        );
    }

    let mut seen = HashSet::new();
    for root in candidates {
        let Ok(root) = fs::canonicalize(root) else {
            continue;
        };
        if !seen.insert(root.clone()) {
            continue;
        }
        let Some(manifest) = package_manifest(&root) else {
            continue;
        };
        let name = manifest
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !PI_PACKAGE_NAMES.contains(&name) {
            continue;
        }
        let Some(entry) = package_entry(&root, &manifest) else {
            continue;
        };
        if !entry.is_file() {
            continue;
        }
        for node in node_candidates(&root) {
            if let Some(node_version) = inspect_node(&node).await {
                return Ok(PiLocation {
                    version: manifest
                        .get("version")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                        .to_string(),
                    package_entry: entry,
                    node_path: node,
                    node_version,
                });
            }
        }
    }
    Err("Pi Coding Agent or a compatible Node >=22.19 runtime was not found.".into())
}

fn worker_path() -> Result<PathBuf, String> {
    let dir = config::config_path().with_file_name("runtime");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join("pi-worker.cjs");
    if fs::read_to_string(&path).ok().as_deref() != Some(WORKER_SOURCE) {
        fs::write(&path, WORKER_SOURCE).map_err(|error| error.to_string())?;
    }
    Ok(path)
}

impl PiBridge {
    pub async fn initialize(cfg: &Value) -> Result<Self, String> {
        let location = locate_pi().await?;
        let fs_root = fs::canonicalize(expand_home(
            cfg.get("fsRoot").and_then(Value::as_str).unwrap_or("~/"),
        ))
        .map_err(|error| format!("Aura Filesystem Root is unavailable: {error}"))?;
        let worker = worker_path()?;
        let mut child = Command::new(&location.node_path)
            .arg(worker)
            .current_dir(&fs_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| error.to_string())?;
        let stdin = child
            .stdin
            .take()
            .ok_or("Pi worker stdin is unavailable.")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Pi worker stdout is unavailable.")?;
        let stderr = child.stderr.take();
        let inner = Arc::new(WorkerInner {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
        });

        let pending = inner.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Some(payload) = line.strip_prefix("AURA_IPC:") else {
                    continue;
                };
                let Ok(message) = serde_json::from_str::<Value>(payload) else {
                    continue;
                };
                if message.get("type").and_then(Value::as_str) != Some("response") {
                    continue;
                }
                let Some(id) = message.get("id").and_then(Value::as_str) else {
                    continue;
                };
                if let Some(sender) = pending.pending.lock().await.remove(id) {
                    let result = if message.get("ok").and_then(Value::as_bool) == Some(true) {
                        Ok(message.get("result").cloned().unwrap_or(Value::Null))
                    } else {
                        Err(message
                            .get("error")
                            .and_then(Value::as_str)
                            .unwrap_or("Pi worker request failed.")
                            .to_string())
                    };
                    let _ = sender.send(result);
                }
            }
        });
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if !line.trim().is_empty() {
                        eprintln!("Pi worker: {line}");
                    }
                }
            });
        }

        let temporary = Self {
            inner,
            version: location.version.clone(),
            node_version: location.node_version.clone(),
            tools: Arc::new(Vec::new()),
            skills: Arc::new(Vec::new()),
            active_tools: Arc::new(HashSet::new()),
            fs_root,
            shell_policy: cfg
                .get("shellPolicy")
                .and_then(Value::as_str)
                .unwrap_or("unrestricted")
                .to_string(),
            shell_allowlist: Arc::new(string_set(cfg.get("shellAllowlist"))),
            shell_denylist: Arc::new(string_set(cfg.get("shellDenylist"))),
        };
        let result = temporary
            .request(
                "initialize",
                json!({
                    "packageEntry": location.package_entry.to_string_lossy(),
                    "cwd": temporary.fs_root.to_string_lossy()
                }),
            )
            .await?;

        let allow_model_tools = cfg
            .get("piAllowModelTools")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let configured = string_set(cfg.get("piTools"));
        let mut tools = result
            .get("tools")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| serde_json::from_value::<PiTool>(value).ok())
            .filter(|tool| tool.name != "request_capabilities")
            .map(|mut tool| {
                tool.category = classify_tool(&tool.name).into();
                tool.uses_pi_default_model = tool.name == "subagent";
                tool
            })
            .collect::<Vec<_>>();
        tools.sort_by(|a, b| a.name.cmp(&b.name));
        let mut skills = result
            .get("skills")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| serde_json::from_value::<PiSkill>(value).ok())
            .collect::<Vec<_>>();
        skills.sort_by(|a, b| a.name.cmp(&b.name));

        let active = tools
            .iter()
            .filter(|tool| {
                configured.contains(&tool.name)
                    && (allow_model_tools || !tool.uses_pi_default_model)
            })
            .map(|tool| tool.name.clone())
            .collect::<HashSet<_>>();
        temporary
            .request(
                "setActiveTools",
                json!({"names": active.iter().collect::<Vec<_>>()}),
            )
            .await?;

        Ok(Self {
            tools: Arc::new(tools),
            skills: Arc::new(skills),
            active_tools: Arc::new(active),
            ..temporary
        })
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        self.inner.pending.lock().await.insert(id.clone(), sender);
        let line = serde_json::to_string(&json!({
            "type": "request",
            "id": id,
            "method": method,
            "params": params
        }))
        .map_err(|error| error.to_string())?;
        {
            let mut stdin = self.inner.stdin.lock().await;
            stdin
                .write_all(format!("{line}\n").as_bytes())
                .await
                .map_err(|error| error.to_string())?;
            stdin.flush().await.map_err(|error| error.to_string())?;
        }
        tokio::time::timeout(std::time::Duration::from_secs(120), receiver)
            .await
            .map_err(|_| format!("Pi worker request '{method}' timed out."))?
            .map_err(|_| "Pi worker stopped before responding.".to_string())?
    }

    pub fn visible_tools(&self) -> Vec<PiTool> {
        self.tools
            .iter()
            .filter(|tool| self.active_tools.contains(&tool.name))
            .cloned()
            .collect()
    }

    pub async fn execute(&self, name: &str, args: Value) -> Result<Value, String> {
        if !self.active_tools.contains(name) {
            return Err(format!(
                "Capability '{name}' is not enabled in Aura Settings."
            ));
        }
        self.validate_authority(name, &args)?;
        self.request("execute", json!({"name": name, "args": args}))
            .await
    }

    fn validate_authority(&self, name: &str, args: &Value) -> Result<(), String> {
        if matches!(name, "read" | "edit" | "write" | "grep" | "find" | "ls") {
            if let Some(path) = args.get("path").and_then(Value::as_str) {
                let raw = Path::new(path);
                let candidate = if raw.is_absolute() {
                    path_clean::PathClean::clean(raw)
                } else {
                    path_clean::PathClean::clean(&self.fs_root.join(raw))
                };
                if !candidate.starts_with(&self.fs_root) {
                    return Err(
                        "Access denied: Pi tool path is outside Aura Filesystem Root.".into(),
                    );
                }
            }
        }
        if matches!(name, "bash" | "powershell") {
            let command = args
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let base = command.split_whitespace().next().unwrap_or_default();
            if self.shell_policy == "allowlist" && !self.shell_allowlist.contains(base) {
                return Err(format!(
                    "Command '{base}' is not in Aura's shell allowlist."
                ));
            }
            if self.shell_policy == "denylist" && self.shell_denylist.contains(base) {
                return Err(format!(
                    "Command '{base}' is explicitly blocked by Aura's denylist."
                ));
            }
        }
        Ok(())
    }

    pub fn read_skill(&self, name: &str, relative: &str) -> Result<String, String> {
        let skill = self
            .skills
            .iter()
            .find(|skill| skill.name == name)
            .ok_or_else(|| format!("Unknown Pi skill '{name}'."))?;
        let base = fs::canonicalize(&skill.base_dir).map_err(|error| error.to_string())?;
        let requested = if relative.trim().is_empty() {
            "SKILL.md"
        } else {
            relative.trim()
        };
        let raw = Path::new(requested);
        if raw.is_absolute() {
            return Err("Skill file path must be relative to the Skill directory.".into());
        }
        let target = path_clean::PathClean::clean(&base.join(raw));
        if !target.starts_with(&base) {
            return Err("Access denied: Skill path escapes the Skill directory.".into());
        }
        let real =
            fs::canonicalize(target).map_err(|_| format!("Skill file not found: {requested}"))?;
        if !real.starts_with(&base) {
            return Err("Access denied: Skill file resolves outside the Skill directory.".into());
        }
        fs::read_to_string(real).map_err(|error| error.to_string())
    }

    pub async fn shutdown(&self) {
        let _ = self.request("shutdown", json!({})).await;
        let mut child = self.inner.child.lock().await;
        if child.try_wait().ok().flatten().is_none() {
            let _ = child.kill().await;
        }
    }
}

fn string_set(value: Option<&Value>) -> HashSet<String> {
    value
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn classify_tool(name: &str) -> &'static str {
    if name == "subagent" {
        "pi-model"
    } else if name.starts_with("gpt_") {
        "external-model"
    } else if matches!(
        name,
        "web_search" | "source_check" | "fetch_content" | "get_search_content"
    ) {
        "network"
    } else if name == "mcp" || name == "mcpScript" || name.starts_with("mcp__") {
        "mcp"
    } else {
        "tool"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires the user's local Pi installation and Aura Pi tool selection"]
    async fn current_config_discovers_and_runs_selected_ls_tool() {
        let cfg = config::effective(&config::load(), None);
        if cfg.get("piEnabled").and_then(Value::as_bool) != Some(true) {
            return;
        }
        let bridge = PiBridge::initialize(&cfg)
            .await
            .expect("Pi bridge should initialize");
        let names = bridge
            .visible_tools()
            .into_iter()
            .map(|tool| tool.name)
            .collect::<Vec<_>>();
        println!("visible Pi tools: {names:?}");
        assert!(
            names.iter().any(|name| name == "ls"),
            "current Aura Pi selection should include ls"
        );

        let result = bridge
            .execute("ls", json!({"path": "."}))
            .await
            .expect("selected Pi ls tool should execute");
        println!("Pi ls result: {result}");
        assert!(result.get("content").and_then(Value::as_array).is_some());
        bridge.shutdown().await;
    }
}
