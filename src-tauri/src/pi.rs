use crate::{config, security};
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

#[derive(Debug, Default)]
pub struct PiToolActivation {
    pub enabled: Vec<String>,
    pub already_active: Vec<String>,
    pub blocked: Vec<String>,
    pub unknown: Vec<String>,
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
    allowed_tools: Arc<HashSet<String>>,
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

fn configured_environment_path(config: &Value) -> Option<&str> {
    config
        .get("environmentPath")
        .and_then(Value::as_str)
        .filter(|path| !path.trim().is_empty())
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

async fn global_npm_root(config: &Value) -> Option<PathBuf> {
    let mut command = Command::new("npm");
    command.args(["root", "-g"]);
    if let Some(path) = configured_environment_path(config) {
        command.env("PATH", path);
    }
    let output = command.output().await.ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!value.is_empty()).then(|| PathBuf::from(value))
}

fn node_candidates(package_root: &Path, config: &Value) -> Vec<PathBuf> {
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
    let path_value = configured_environment_path(config)
        .map(std::ffi::OsString::from)
        .or_else(|| env::var_os("PATH"))
        .unwrap_or_default();
    candidates.extend(env::split_paths(&path_value).map(|dir| dir.join(node_name)));
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

async fn locate_pi(cfg: &Value) -> Result<PiLocation, String> {
    let configured_path = cfg
        .get("piBinaryPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty());
    let mut candidates = Vec::new();

    if let Some(path_str) = configured_path {
        let expanded = expand_home(path_str);
        let canon = fs::canonicalize(&expanded).map_err(|error| {
            format!("Configured Pi Binary Path '{path_str}' is unavailable: {error}")
        })?;
        let mut current = Some(canon.as_path());
        while let Some(path) = current {
            let directory = if path.is_dir() {
                path
            } else {
                path.parent().unwrap_or(path)
            };
            if directory.join("package.json").is_file() {
                if let Some(manifest) = package_manifest(directory) {
                    let name = manifest
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if PI_PACKAGE_NAMES.contains(&name) {
                        candidates.push(directory.to_path_buf());
                        break;
                    }
                }
            }
            current = directory.parent();
        }
    } else {
        candidates.extend(package_candidates());
        if let Some(npm_root) = global_npm_root(cfg).await {
            for name in PI_PACKAGE_NAMES {
                candidates.push(npm_root.join(name));
            }
            candidates.push(
                npm_root
                    .join("@agegr/pi-web/node_modules")
                    .join(PI_PACKAGE_NAMES[0]),
            );
        }
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
        for node in node_candidates(&root, cfg) {
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
    if let Some(path) = configured_path {
        Err(format!(
            "Configured Pi Binary Path '{path}' does not resolve to a supported Pi Coding Agent installation with Node >=22.19."
        ))
    } else {
        Err("Pi Coding Agent or a compatible Node >=22.19 runtime was not found.".into())
    }
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
        let location = locate_pi(cfg).await?;
        let fs_root = fs::canonicalize(expand_home(
            cfg.get("fsRoot").and_then(Value::as_str).unwrap_or("~/"),
        ))
        .map_err(|error| format!("Aura Filesystem Root is unavailable: {error}"))?;
        let worker = worker_path()?;
        let mut command = Command::new(&location.node_path);
        command
            .arg(worker)
            .current_dir(&fs_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(path) = configured_environment_path(cfg) {
            command.env("PATH", path);
        }
        let mut child = command.spawn().map_err(|error| error.to_string())?;
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
            allowed_tools: Arc::new(HashSet::new()),
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

        let allowed = tools
            .iter()
            .filter(|tool| {
                configured.contains(&tool.name)
                    && (allow_model_tools || !tool.uses_pi_default_model)
            })
            .map(|tool| tool.name.clone())
            .collect::<HashSet<_>>();

        Ok(Self {
            tools: Arc::new(tools),
            skills: Arc::new(skills),
            allowed_tools: Arc::new(allowed),
            ..temporary
        })
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.request_with_timeout(method, params, std::time::Duration::from_secs(120))
            .await
    }

    async fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: std::time::Duration,
    ) -> Result<Value, String> {
        let id = Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        self.inner.pending.lock().await.insert(id.clone(), sender);
        let line = serde_json::to_string(&json!({
            "type": "request",
            "id": id.clone(),
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
        match tokio::time::timeout(timeout, receiver).await {
            Ok(result) => result.map_err(|_| "Pi worker stopped before responding.".to_string())?,
            Err(_) => {
                self.inner.pending.lock().await.remove(&id);
                Err(format!("Pi worker request '{method}' timed out."))
            }
        }
    }

    pub fn allowed_tool_count(&self) -> usize {
        self.allowed_tools.len()
    }

    pub fn allowed_tool(&self, name: &str) -> Option<PiTool> {
        if !self.allowed_tools.contains(name) {
            return None;
        }
        self.tools.iter().find(|tool| tool.name == name).cloned()
    }

    pub async fn active_tool_names(&self) -> Result<HashSet<String>, String> {
        let result = self.request("getActiveTools", json!({})).await?;
        Ok(result
            .get("active")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|name| self.allowed_tools.contains(*name))
            .map(ToOwned::to_owned)
            .collect())
    }

    pub async fn visible_tools(&self) -> Result<Vec<PiTool>, String> {
        let active = self.active_tool_names().await?;
        Ok(self
            .tools
            .iter()
            .filter(|tool| active.contains(&tool.name))
            .cloned()
            .collect())
    }

    pub async fn enable_tools(
        &self,
        requested_names: &[String],
    ) -> Result<PiToolActivation, String> {
        let known = self
            .tools
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<HashSet<_>>();
        let mut seen = HashSet::new();
        let mut allowed = Vec::new();
        let mut activation = PiToolActivation::default();

        for raw_name in requested_names {
            let name = raw_name.trim();
            if name.is_empty() || !seen.insert(name.to_string()) {
                continue;
            }
            if !known.contains(name) {
                activation.unknown.push(name.to_string());
            } else if !self.allowed_tools.contains(name) {
                activation.blocked.push(name.to_string());
            } else {
                allowed.push(name.to_string());
            }
        }

        if allowed.is_empty() {
            return Ok(activation);
        }

        let result = self
            .request("enableTools", json!({"names": allowed}))
            .await?;
        let strings = |key: &str| {
            result
                .get(key)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        };
        activation.enabled = strings("enabled");
        activation.already_active = strings("alreadyActive");
        activation.unknown.extend(strings("unknown"));
        Ok(activation)
    }

    pub async fn execute(&self, name: &str, args: Value) -> Result<Value, String> {
        if !self.allowed_tools.contains(name) {
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
                let target = Path::new(path);
                if name == "write" {
                    security::resolve_write_path(&self.fs_root, target)?;
                } else {
                    security::resolve_existing_path(&self.fs_root, target)?;
                }
            }
        }
        if matches!(name, "bash" | "powershell") {
            let command = args
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default();
            security::validate_shell_policy(
                command,
                &self.shell_policy,
                &self.shell_allowlist,
                &self.shell_denylist,
            )?;
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
        let _ = self
            .request_with_timeout("shutdown", json!({}), std::time::Duration::from_secs(2))
            .await;
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
    async fn configured_pi_path_fails_closed_when_missing() {
        let cfg = json!({"piBinaryPath": "/definitely/missing/aura-pi"});
        let error = match locate_pi(&cfg).await {
            Ok(_) => panic!("configured Pi path must not fall back to auto-detection"),
            Err(error) => error,
        };
        assert!(error.contains("Configured Pi Binary Path"));
    }

    #[tokio::test]
    async fn worker_binds_extensions_before_snapshot_and_emits_shutdown() {
        let node_available = Command::new("node")
            .arg("--version")
            .output()
            .await
            .map(|output| output.status.success())
            .unwrap_or(false);
        if !node_available {
            eprintln!("Skipping pi-worker lifecycle test because node is unavailable.");
            return;
        }

        let temp_dir = env::temp_dir().join(format!("aura-pi-worker-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).expect("create pi-worker test directory");
        let worker = temp_dir.join("pi-worker.cjs");
        let sdk = temp_dir.join("fake-sdk.mjs");
        fs::write(&worker, WORKER_SOURCE).expect("write pi-worker fixture");
        fs::write(
            &sdk,
            r#"
export const SessionManager = {
  inMemory(cwd) { return { cwd }; }
};

export async function createAgentSession() {
  const tools = new Map();
  let active = [];
  const session = {
    async bindExtensions() {
      tools.set('deferred_tool', {
        name: 'deferred_tool',
        description: 'registered during session_start',
        parameters: { type: 'object', properties: {} }
      });
    },
    getAllTools() {
      return [...tools.values()].map(tool => ({
        name: tool.name,
        description: tool.description,
        sourceInfo: { source: 'fixture' }
      }));
    },
    getToolDefinition(name) { return tools.get(name); },
    resourceLoader: { getSkills() { return { skills: [] }; } },
    setActiveToolsByName(names) { active = [...names]; },
    getActiveToolNames() { return [...active]; },
    extensionRunner: {
      hasHandlers(name) { return name === 'session_shutdown'; },
      async emit(event) {
        if (event.type === 'session_shutdown') {
          process.stdout.write('FIXTURE_SESSION_SHUTDOWN\n');
        }
      }
    },
    dispose() {}
  };
  return { session };
}
"#,
        )
        .expect("write fake Pi SDK");

        let mut child = Command::new("node")
            .arg(&worker)
            .current_dir(&temp_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .expect("spawn pi-worker lifecycle fixture");
        let mut stdin = child.stdin.take().expect("worker stdin");
        let stdout = child.stdout.take().expect("worker stdout");
        let mut lines = BufReader::new(stdout).lines();

        let init = json!({
            "type": "request",
            "id": "init",
            "method": "initialize",
            "params": {
                "packageEntry": sdk.to_string_lossy(),
                "cwd": temp_dir.to_string_lossy()
            }
        });
        stdin
            .write_all(format!("{init}\n").as_bytes())
            .await
            .expect("send worker initialize");
        stdin.flush().await.expect("flush worker initialize");

        let init_response = tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let line = lines
                    .next_line()
                    .await
                    .expect("read worker initialize line")
                    .expect("worker exited before initialize response");
                let Some(payload) = line.strip_prefix("AURA_IPC:") else {
                    continue;
                };
                let message: Value = serde_json::from_str(payload).expect("parse worker response");
                if message.get("type").and_then(Value::as_str) == Some("response")
                    && message.get("id").and_then(Value::as_str) == Some("init")
                {
                    break message;
                }
            }
        })
        .await
        .expect("worker initialize timed out");
        assert_eq!(init_response.get("ok").and_then(Value::as_bool), Some(true));
        let discovered = init_response
            .pointer("/result/tools")
            .and_then(Value::as_array)
            .expect("worker initialize tools");
        assert!(
            discovered
                .iter()
                .any(|tool| tool.get("name").and_then(Value::as_str) == Some("deferred_tool")),
            "Aura must bind extensions before snapshotting getAllTools()"
        );

        let shutdown = json!({
            "type": "request",
            "id": "shutdown",
            "method": "shutdown",
            "params": {}
        });
        stdin
            .write_all(format!("{shutdown}\n").as_bytes())
            .await
            .expect("send worker shutdown");
        stdin.flush().await.expect("flush worker shutdown");

        let saw_shutdown_event = tokio::time::timeout(std::time::Duration::from_secs(10), async {
            let mut saw_event = false;
            while let Some(line) = lines.next_line().await.expect("read worker shutdown line") {
                if line == "FIXTURE_SESSION_SHUTDOWN" {
                    saw_event = true;
                }
            }
            saw_event
        })
        .await
        .expect("worker shutdown timed out");
        assert!(
            saw_shutdown_event,
            "Aura must emit session_shutdown before disposing a bound Pi session"
        );

        let status = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait())
            .await
            .expect("worker exit timed out")
            .expect("wait for worker exit");
        assert!(
            status.success(),
            "worker should exit cleanly after shutdown"
        );
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[tokio::test]
    #[ignore = "requires the user's local Pi installation and Aura Pi tool selection"]
    async fn current_config_enforces_activation_allowlist_and_authority() {
        let cfg = config::effective(&config::load(), None);
        if cfg.get("piEnabled").and_then(Value::as_bool) != Some(true) {
            return;
        }
        let bridge = PiBridge::initialize(&cfg)
            .await
            .expect("Pi bridge should initialize");

        let inactive = bridge
            .tools
            .iter()
            .find(|tool| bridge.allowed_tools.contains(&tool.name))
            .map(|tool| tool.name.clone())
            .expect("at least one Pi tool must be selected in Aura Settings");
        let error = bridge
            .execute(&inactive, json!({}))
            .await
            .expect_err("inactive Pi tools must not execute");
        assert!(error.contains("not present in the active Pi tool set"));

        let unknown = bridge
            .enable_tools(&["__aura_unknown_tool__".to_string()])
            .await
            .expect("unknown activation should return a classified result");
        assert_eq!(unknown.unknown, vec!["__aura_unknown_tool__"]);

        if let Some(blocked_name) = bridge
            .tools
            .iter()
            .find(|tool| !bridge.allowed_tools.contains(&tool.name))
            .map(|tool| tool.name.clone())
        {
            let blocked = bridge
                .enable_tools(&[blocked_name.clone()])
                .await
                .expect("blocked activation should return a classified result");
            assert_eq!(blocked.blocked, vec![blocked_name]);
        }

        let traversal = bridge
            .validate_authority("read", &json!({"path": "/private/etc/passwd"}))
            .expect_err("file tools must not escape Aura Filesystem Root");
        assert!(traversal.contains("outside the configured Filesystem Root"));

        let allowlist_bridge = PiBridge {
            shell_policy: "allowlist".into(),
            shell_allowlist: Arc::new(HashSet::from(["echo".to_string()])),
            ..bridge
        };
        let shell_error = allowlist_bridge
            .validate_authority("bash", &json!({"command": "uname -a"}))
            .expect_err("shell compatibility execution must preserve Aura Shell Policy");
        assert!(shell_error.contains("not in Aura's shell allowlist"));
        let chained = allowlist_bridge
            .validate_authority("bash", &json!({"command": "echo ok; uname -a"}))
            .expect_err("restricted shell policy must reject chained commands");
        assert!(chained.contains("Shell chaining"));
        allowlist_bridge.shutdown().await;
    }

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
        let initial = bridge
            .visible_tools()
            .await
            .expect("active Pi tools should be readable")
            .into_iter()
            .map(|tool| tool.name)
            .collect::<Vec<_>>();
        println!("initial visible Pi tools: {initial:?}");
        assert!(
            !initial.iter().any(|name| name == "ls"),
            "allowed Pi tools should start inactive until requested"
        );

        let activation = bridge
            .enable_tools(&["ls".to_string()])
            .await
            .expect("selected Pi ls tool should activate");
        assert!(
            activation.enabled.iter().any(|name| name == "ls")
                || activation.already_active.iter().any(|name| name == "ls"),
            "ls should become active after capability activation"
        );

        let names = bridge
            .visible_tools()
            .await
            .expect("active Pi tools should be readable after activation")
            .into_iter()
            .map(|tool| tool.name)
            .collect::<Vec<_>>();
        println!("visible Pi tools after activation: {names:?}");
        assert!(names.iter().any(|name| name == "ls"));

        let result = bridge
            .execute("ls", json!({"path": "."}))
            .await
            .expect("activated Pi ls tool should execute");
        println!("Pi ls result: {result}");
        assert!(result.get("content").and_then(Value::as_array).is_some());
        bridge.shutdown().await;
    }
}
