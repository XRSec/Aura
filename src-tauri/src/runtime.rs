use crate::{config, pi::PiBridge, security, skills};
use axum::{
    extract::{Form, Json, Query, State},
    http::{header, HeaderValue, Request, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
    Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rmcp::{
    handler::server::{router::tool::ToolRouter, tool::ToolCallContext, wrapper::Parameters},
    model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerInfo, Tool},
    schemars, tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ServerHandler,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    net::SocketAddr,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::{mpsc, Mutex, RwLock},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;
use tower_http::cors::CorsLayer;
use url::Url;
use uuid::Uuid;

const CHATGPT_CALLBACK: &str = "https://chatgpt.com/connector_platform_oauth_redirect";
const CHATGPT_CALLBACK_PREFIX: &str = "https://chatgpt.com/connector/oauth/";
const KEYRING_SERVICE: &str = "fun.xrsec.aura";
const KEYRING_ACCOUNT: &str = "admin-password";

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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

#[cfg(not(target_os = "windows"))]
async fn detect_user_environment_path() -> Result<String, String> {
    let shell = env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .unwrap_or_else(|| {
            if cfg!(target_os = "macos") {
                PathBuf::from("/bin/zsh")
            } else {
                PathBuf::from("/bin/sh")
            }
        });
    let mut command = Command::new(&shell);
    command
        .args(["-lic", "printf '\\n__AURA_PATH__=%s\\n' \"$PATH\""])
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(10), command.output())
        .await
        .map_err(|_| format!("Timed out while reading PATH from {}.", shell.display()))?
        .map_err(|error| format!("Failed to start {}: {error}", shell.display()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("{} exited with {}.", shell.display(), output.status)
        } else {
            format!(
                "{} exited with {}: {stderr}",
                shell.display(),
                output.status
            )
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let path = stdout
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix("__AURA_PATH__="))
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{} did not return PATH.", shell.display()))?;
    if path.trim().is_empty() {
        return Err(format!("{} returned an empty PATH.", shell.display()));
    }
    Ok(path)
}

#[cfg(target_os = "windows")]
async fn detect_user_environment_path() -> Result<String, String> {
    env::var("PATH").map_err(|error| format!("Unable to read PATH: {error}"))
}

async fn ensure_environment_path(app: &AppHandle, stored_config: &mut Value) {
    if configured_environment_path(stored_config).is_some() {
        return;
    }
    match detect_user_environment_path().await {
        Ok(path) => {
            if let Some(root) = stored_config.as_object_mut() {
                root.insert("environmentPath".into(), Value::String(path));
            }
            match config::write(stored_config) {
                Ok(()) => emit_runtime(app, "info", "Environment PATH auto-detected and saved."),
                Err(error) => emit_runtime(
                    app,
                    "warn",
                    &format!("Environment PATH was detected but could not be saved: {error}"),
                ),
            }
        }
        Err(error) => emit_runtime(
            app,
            "warn",
            &format!("Environment PATH auto-detection failed: {error}"),
        ),
    }
}

fn safe_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn valid_redirect_uri(value: &str) -> bool {
    value == CHATGPT_CALLBACK || value.starts_with(CHATGPT_CALLBACK_PREFIX)
}

fn verify_pkce(verifier: &str, challenge: &str) -> bool {
    if verifier.is_empty() || challenge.is_empty() {
        return false;
    }
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())) == challenge
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|error| error.to_string())
}

pub fn save_admin_secret(secret: &str) -> Result<(), String> {
    if secret.is_empty() {
        return Err("Admin password cannot be empty.".into());
    }
    keyring_entry()?
        .set_password(secret)
        .map_err(|error| error.to_string())?;
    let mut cfg = config::load();
    if let Some(root) = cfg.as_object_mut() {
        root.insert("adminSecret".into(), Value::String("keyring".into()));
    }
    config::write(&cfg).map_err(|error| error.to_string())
}

fn verify_admin_secret(configured: Option<&str>, input: &str) -> bool {
    #[cfg(test)]
    if let Some(expected) = configured.and_then(|value| value.strip_prefix("test:")) {
        return input == expected;
    }

    match configured.map(str::trim).filter(|value| !value.is_empty()) {
        None => false,
        Some("keyring") => keyring_entry()
            .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
            .map(|stored| stored == input)
            .unwrap_or(false),
        // Electron safeStorage blobs cannot be decrypted by the Tauri runtime.
        // Fail closed until the user explicitly stores a new password in the OS keyring.
        Some(_) => false,
    }
}

fn parse_token_validity_seconds(raw: &str) -> u64 {
    const MIN_SECONDS: u64 = 5 * 60;
    const MAX_SECONDS: u64 = 365 * 24 * 60 * 60;
    let raw = raw.trim().to_ascii_lowercase();
    let (number, multiplier) = if let Some(value) = raw.strip_suffix('m') {
        (value, 60_u64)
    } else if let Some(value) = raw.strip_suffix('h') {
        (value, 60 * 60)
    } else if let Some(value) = raw.strip_suffix('d') {
        (value, 24 * 60 * 60)
    } else {
        (raw.as_str(), 1)
    };
    number
        .parse::<u64>()
        .ok()
        .and_then(|value| value.checked_mul(multiplier))
        .unwrap_or(24 * 60 * 60)
        .clamp(MIN_SECONDS, MAX_SECONDS)
}

fn token_validity_seconds() -> u64 {
    let raw = config::load()
        .get("tokenValidity")
        .and_then(Value::as_str)
        .unwrap_or("24h")
        .to_string();
    parse_token_validity_seconds(&raw)
}

fn format_token_duration(seconds: u64) -> String {
    if seconds % (24 * 60 * 60) == 0 {
        format!("{}d", seconds / (24 * 60 * 60))
    } else if seconds % (60 * 60) == 0 {
        format!("{}h", seconds / (60 * 60))
    } else if seconds % 60 == 0 {
        format!("{}m", seconds / 60)
    } else {
        format!("{seconds}s")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TokenRecord {
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "clientId")]
    client_id: String,
    #[serde(rename = "expiresAt", default)]
    expires_at: Option<u64>,
    #[serde(rename = "issuedAt", default)]
    issued_at: Option<u64>,
    #[serde(default)]
    duration: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ClientRecord {
    client_id: String,
    #[serde(default)]
    client_name: String,
    #[serde(default)]
    redirect_uris: Vec<String>,
}

#[derive(Debug, Clone)]
struct AuthCode {
    client_id: String,
    redirect_uri: String,
    code_challenge: String,
    expires_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PersistedAuth {
    #[serde(default)]
    tokens: Vec<(String, TokenRecord)>,
    #[serde(default)]
    clients: Vec<(String, ClientRecord)>,
}

#[derive(Debug, Default)]
struct AuthData {
    tokens: HashMap<String, TokenRecord>,
    clients: HashMap<String, ClientRecord>,
    codes: HashMap<String, AuthCode>,
}

#[derive(Debug)]
pub struct AuthStore {
    data: RwLock<AuthData>,
    path: PathBuf,
}

impl AuthStore {
    pub fn load_from(path: PathBuf) -> Self {
        let persisted = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<PersistedAuth>(&text).ok())
            .unwrap_or_default();
        Self {
            data: RwLock::new(AuthData {
                tokens: persisted.tokens.into_iter().collect(),
                clients: persisted.clients.into_iter().collect(),
                codes: HashMap::new(),
            }),
            path,
        }
    }

    pub fn load() -> Self {
        Self::load_from(config::config_path().with_file_name("aura-tokens.json"))
    }

    async fn persist(&self) -> Result<(), String> {
        let data = self.data.read().await;
        let persisted = PersistedAuth {
            tokens: data
                .tokens
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
            clients: data
                .clients
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
        };
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(
            &self.path,
            serde_json::to_vec_pretty(&persisted).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    }

    async fn access_token_valid(&self, token: &str) -> bool {
        let data = self.data.read().await;
        data.tokens
            .get(token)
            .map(|record| {
                record.kind == "access" && record.expires_at.unwrap_or_default() > now_ms()
            })
            .unwrap_or(false)
    }

    async fn issue_tokens(&self, client_id: &str) -> Result<Value, String> {
        let access_token = format!(
            "mcp_at_{}{}",
            Uuid::new_v4().simple(),
            Uuid::new_v4().simple()
        );
        let refresh_token = format!(
            "mcp_rt_{}{}",
            Uuid::new_v4().simple(),
            Uuid::new_v4().simple()
        );
        let expires_in = token_validity_seconds();
        let issued_at = now_ms();
        let expires_at = issued_at + expires_in * 1000;
        let duration = format_token_duration(expires_in);
        {
            let mut data = self.data.write().await;
            data.tokens.insert(
                access_token.clone(),
                TokenRecord {
                    kind: "access".into(),
                    client_id: client_id.into(),
                    expires_at: Some(expires_at),
                    issued_at: Some(issued_at),
                    duration: Some(duration.clone()),
                },
            );
            data.tokens.insert(
                refresh_token.clone(),
                TokenRecord {
                    kind: "refresh".into(),
                    client_id: client_id.into(),
                    expires_at: Some(expires_at),
                    issued_at: Some(issued_at),
                    duration: Some(duration),
                },
            );
        }
        self.persist().await?;
        Ok(json!({
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": expires_in,
            "refresh_token": refresh_token
        }))
    }

    pub async fn active_tokens(&self) -> Vec<Value> {
        let fallback_duration = token_validity_seconds() * 1000;
        let data = self.data.read().await;
        let mut tokens = data
            .tokens
            .iter()
            .filter_map(|(token, record)| {
                if record.kind != "access" {
                    return None;
                }
                let expires_at = record.expires_at.unwrap_or_default();
                Some(json!({
                    "token": token,
                    "client_id": record.client_id,
                    "issuedAt": record.issued_at.unwrap_or_else(|| expires_at.saturating_sub(fallback_duration)),
                    "duration": record.duration.clone().unwrap_or_else(|| format_token_duration(fallback_duration / 1000))
                }))
            })
            .collect::<Vec<_>>();
        tokens.sort_by_key(|item| {
            item.get("issuedAt")
                .and_then(Value::as_u64)
                .unwrap_or_default()
        });
        tokens
    }

    pub async fn revoke(&self, token: &str) -> bool {
        let deleted = {
            let mut data = self.data.write().await;
            let Some(client_id) = data
                .tokens
                .get(token)
                .map(|record| record.client_id.clone())
            else {
                return false;
            };
            let before = data.tokens.len();
            data.tokens
                .retain(|_, record| record.client_id != client_id);
            data.tokens.len() != before
        };
        if deleted {
            let _ = self.persist().await;
        }
        deleted
    }
}

#[derive(Clone)]
struct WebState {
    auth: Arc<AuthStore>,
    mode: String,
    resource_url: String,
    admin_secret_marker: Option<String>,
}

fn resource_url_from_config(config: &Value, mcp_path: &str) -> String {
    let base = config
        .get("mcpUrl")
        .and_then(Value::as_str)
        .unwrap_or("https://mcp.yourdomain.com")
        .trim_end_matches('/');
    if base.ends_with(mcp_path) {
        base.to_string()
    } else {
        format!("{base}{mcp_path}")
    }
}

fn resource_url(state: &WebState) -> &str {
    &state.resource_url
}

fn authorization_metadata(state: &WebState) -> Value {
    let issuer = resource_url(state);
    json!({
        "issuer": issuer,
        "authorization_endpoint": format!("{issuer}/oauth/authorize"),
        "token_endpoint": format!("{issuer}/oauth/token"),
        "registration_endpoint": format!("{issuer}/oauth/register"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": ["none"],
        "code_challenge_methods_supported": ["S256"],
        "scopes_supported": ["mcp"],
        "client_id_metadata_document_supported": true
    })
}

fn protected_metadata(state: &WebState) -> Value {
    let resource = resource_url(state);
    json!({
        "resource": resource,
        "authorization_servers": [resource],
        "scopes_supported": ["mcp"],
        "bearer_methods_supported": ["header"]
    })
}

async fn protected_metadata_handler(State(state): State<Arc<WebState>>) -> Json<Value> {
    Json(protected_metadata(&state))
}

async fn authorization_metadata_handler(State(state): State<Arc<WebState>>) -> Json<Value> {
    Json(authorization_metadata(&state))
}

async fn register_client(State(state): State<Arc<WebState>>, Json(body): Json<Value>) -> Response {
    let redirects = body
        .get("redirect_uris")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if redirects.is_empty() || !redirects.iter().all(|uri| valid_redirect_uri(uri)) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"invalid_redirect_uri"})),
        )
            .into_response();
    }
    if body
        .get("token_endpoint_auth_method")
        .and_then(Value::as_str)
        .is_some_and(|method| method != "none")
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"invalid_client_metadata"})),
        )
            .into_response();
    }

    let client_id = format!("{}", Uuid::new_v4().simple());
    let client_name = body
        .get("client_name")
        .and_then(Value::as_str)
        .unwrap_or("ChatGPT")
        .to_string();
    {
        let mut data = state.auth.data.write().await;
        data.clients.insert(
            client_id.clone(),
            ClientRecord {
                client_id: client_id.clone(),
                client_name: client_name.clone(),
                redirect_uris: redirects.clone(),
            },
        );
    }
    let _ = state.auth.persist().await;
    (
        StatusCode::CREATED,
        Json(json!({
            "client_id": client_id,
            "client_name": client_name,
            "redirect_uris": redirects,
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"]
        })),
    )
        .into_response()
}

fn auth_html(values: &HashMap<String, String>, error: &str) -> String {
    let client_id = values
        .get("client_id")
        .map(String::as_str)
        .unwrap_or("ChatGPT");
    let redirect_uri = values
        .get("redirect_uri")
        .map(String::as_str)
        .unwrap_or_default();
    let challenge = values
        .get("code_challenge")
        .map(String::as_str)
        .unwrap_or_default();
    let state = values.get("state").map(String::as_str).unwrap_or_default();
    let error_html = if error.is_empty() {
        String::new()
    } else {
        format!("<div class=\"error\">{}</div>", safe_text(error))
    };
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize Aura</title><style>body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0d0d0f;color:#f4f4f5;min-height:100vh;display:grid;place-items:center;margin:0}}main{{width:min(390px,calc(100% - 40px));background:#18181bcc;border:1px solid #ffffff14;border-radius:12px;padding:28px}}h1{{font-size:19px}}p,label{{color:#a1a1aa;font-size:13px}}input{{box-sizing:border-box;width:100%;height:42px;background:#ffffff0a;border:1px solid #ffffff18;border-radius:9px;color:#fff;padding:0 12px;margin:8px 0 18px}}button{{width:100%;height:42px;border:0;border-radius:9px;background:#339cff;color:#fff;font-weight:600}}.error{{color:#fca5a5;background:#ef44441f;border:1px solid #ef444447;padding:10px;border-radius:8px;margin:12px 0}}</style></head><body><main><h1>Authorize Aura MCP</h1><p>Client <strong>{client}</strong> is requesting access to Aura tools on this computer.</p>{error}<form method="post"><input type="hidden" name="client_id" value="{client}"><input type="hidden" name="redirect_uri" value="{redirect}"><input type="hidden" name="code_challenge" value="{challenge}"><input type="hidden" name="code_challenge_method" value="S256"><input type="hidden" name="response_type" value="code"><input type="hidden" name="state" value="{state}"><label>Admin Password</label><input name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Approve Access</button></form></main></body></html>"#,
        client = safe_text(client_id),
        redirect = safe_text(redirect_uri),
        challenge = safe_text(challenge),
        state = safe_text(state),
        error = error_html
    )
}

fn valid_auth_request(values: &HashMap<String, String>) -> bool {
    let redirect = values
        .get("redirect_uri")
        .map(String::as_str)
        .unwrap_or_default();
    let challenge = values
        .get("code_challenge")
        .map(String::as_str)
        .unwrap_or_default();
    valid_redirect_uri(redirect)
        && !challenge.is_empty()
        && values
            .get("code_challenge_method")
            .map(String::as_str)
            .unwrap_or_default()
            == "S256"
        && values
            .get("response_type")
            .map(String::as_str)
            .unwrap_or("code")
            == "code"
}

async fn authorize_get(
    State(_state): State<Arc<WebState>>,
    Query(values): Query<HashMap<String, String>>,
) -> Response {
    if !valid_auth_request(&values) {
        return (
            StatusCode::BAD_REQUEST,
            "Invalid OAuth request. Reconnect from ChatGPT.",
        )
            .into_response();
    }
    Html(auth_html(&values, "")).into_response()
}

async fn authorize_post(
    State(state): State<Arc<WebState>>,
    Form(values): Form<HashMap<String, String>>,
) -> Response {
    if !valid_auth_request(&values) {
        return (
            StatusCode::BAD_REQUEST,
            "Invalid OAuth request. Reconnect from ChatGPT.",
        )
            .into_response();
    }
    let password = values
        .get("password")
        .map(String::as_str)
        .unwrap_or_default();
    if !verify_admin_secret(state.admin_secret_marker.as_deref(), password) {
        return (
            StatusCode::UNAUTHORIZED,
            Html(auth_html(
                &values,
                "Incorrect Admin Password. Please try again.",
            )),
        )
            .into_response();
    }
    let code = Uuid::new_v4().to_string();
    let client_id = values.get("client_id").cloned().unwrap_or_default();
    let redirect_uri = values.get("redirect_uri").cloned().unwrap_or_default();
    let code_challenge = values.get("code_challenge").cloned().unwrap_or_default();
    let oauth_state = values.get("state").cloned();
    state.auth.data.write().await.codes.insert(
        code.clone(),
        AuthCode {
            client_id,
            redirect_uri: redirect_uri.clone(),
            code_challenge,
            expires_at: now_ms() + 5 * 60 * 1000,
        },
    );
    let Ok(mut redirect) = Url::parse(&redirect_uri) else {
        return (StatusCode::BAD_REQUEST, "Invalid redirect URI structure.").into_response();
    };
    redirect.query_pairs_mut().append_pair("code", &code);
    if let Some(value) = oauth_state {
        redirect.query_pairs_mut().append_pair("state", &value);
    }
    Redirect::to(redirect.as_str()).into_response()
}

async fn token_exchange(
    State(state): State<Arc<WebState>>,
    Form(body): Form<HashMap<String, String>>,
) -> Response {
    let grant_type = body
        .get("grant_type")
        .map(String::as_str)
        .unwrap_or_default();
    if grant_type == "refresh_token" {
        let refresh = body
            .get("refresh_token")
            .map(String::as_str)
            .unwrap_or_default();
        let client_id = {
            let mut data = state.auth.data.write().await;
            let client_id = data.tokens.get(refresh).and_then(|entry| {
                (entry.kind == "refresh"
                    && entry.expires_at.is_some_and(|expiry| expiry > now_ms()))
                .then(|| entry.client_id.clone())
            });
            if client_id.is_some() {
                data.tokens.remove(refresh);
            }
            client_id
        };
        let Some(client_id) = client_id else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error":"invalid_grant"})),
            )
                .into_response();
        };
        return match state.auth.issue_tokens(&client_id).await {
            Ok(tokens) => Json(tokens).into_response(),
            Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error).into_response(),
        };
    }
    if grant_type != "authorization_code" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"unsupported_grant_type"})),
        )
            .into_response();
    }

    let code = body.get("code").map(String::as_str).unwrap_or_default();
    let stored = state.auth.data.write().await.codes.remove(code);
    let Some(stored) = stored else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"invalid_grant"})),
        )
            .into_response();
    };
    let valid = stored.expires_at > now_ms()
        && stored.client_id == body.get("client_id").cloned().unwrap_or_default()
        && stored.redirect_uri == body.get("redirect_uri").cloned().unwrap_or_default()
        && verify_pkce(
            body.get("code_verifier")
                .map(String::as_str)
                .unwrap_or_default(),
            &stored.code_challenge,
        );
    if !valid {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"invalid_grant"})),
        )
            .into_response();
    }
    match state.auth.issue_tokens(&stored.client_id).await {
        Ok(tokens) => Json(tokens).into_response(),
        Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error).into_response(),
    }
}

async fn authorize_mcp(
    State(state): State<Arc<WebState>>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    if state.mode == "openai" {
        return next.run(request).await;
    }
    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();
    if state.auth.access_token_valid(token).await {
        return next.run(request).await;
    }

    let metadata = format!(
        "{}/.well-known/oauth-protected-resource",
        resource_url(&state)
    );
    let mut response = (
        StatusCode::UNAUTHORIZED,
        Json(json!({"error":"unauthorized"})),
    )
        .into_response();
    if let Ok(value) = HeaderValue::from_str(&format!("Bearer resource_metadata=\"{metadata}\"")) {
        response
            .headers_mut()
            .insert(header::WWW_AUTHENTICATE, value);
    }
    response
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct ReadFileRequest {
    path: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct WriteFileRequest {
    path: String,
    content: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct ExecuteShellRequest {
    command: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct ReadSkillRequest {
    skill: String,
    #[serde(default = "default_skill_file")]
    path: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct RequestCapabilitiesRequest {
    #[serde(default)]
    tools: Vec<String>,
    #[serde(default)]
    skills: Vec<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct DescribePiToolRequest {
    name: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct ExecutePiToolRequest {
    name: String,
    #[serde(default)]
    arguments: Value,
}

fn default_skill_file() -> String {
    "SKILL.md".into()
}

fn resolve_safe_path(fs_root: &str, target: &str) -> Result<PathBuf, String> {
    security::resolve_existing_path(&expand_home(fs_root), Path::new(target))
}

fn resolve_safe_write_path(fs_root: &str, target: &str) -> Result<PathBuf, String> {
    security::resolve_write_path(&expand_home(fs_root), Path::new(target))
}

fn bounded_log_text(value: &str) -> String {
    const LIMIT: usize = 5000;
    if value.len() <= LIMIT {
        return value.to_string();
    }
    let mut end = LIMIT;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!(
        "{}... [truncated {} chars]",
        &value[..end],
        value.chars().count()
    )
}

#[derive(Clone)]
struct AuraMcpServer {
    app: Option<tauri::AppHandle>,
    tool_router: ToolRouter<Self>,
    config: Value,
    pi: Option<Arc<PiBridge>>,
}

impl std::fmt::Debug for AuraMcpServer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuraMcpServer")
            .field("tool_router", &self.tool_router)
            .field("pi_enabled", &self.pi.is_some())
            .finish()
    }
}

impl AuraMcpServer {
    fn log_execution(
        &self,
        tool: &str,
        params: serde_json::Value,
        result: &str,
        output: Option<String>,
        error: Option<String>,
        duration: u64,
    ) {
        if let Some(app) = &self.app {
            let entry = serde_json::json!({
                "timestamp": crate::runtime::now_ms(),
                "mcpMethod": "tools/call",
                "tool": tool,
                "params": params,
                "result": result,
                "output": output.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null),
                "error": error.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null),
                "duration": duration,
                "http": crate::http_logger::current_http_context().unwrap_or(serde_json::Value::Null)
            });
            if !crate::http_logger::defer_mcp_log(entry.clone()) {
                crate::runtime::emit_mcp_log(app, entry);
            }
        }
    }

    fn new(app: Option<tauri::AppHandle>, config: Value, pi: Option<Arc<PiBridge>>) -> Self {
        let mut tool_router = Self::tool_router();
        let enabled = config
            .get("defaultCapabilitiesEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let selected = config
            .get("defaultTools")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<HashSet<_>>()
            })
            .unwrap_or_default();
        for name in [
            "read_file",
            "write_file",
            "execute_shell",
            "list_skills",
            "read_skill",
        ] {
            if !enabled || !selected.contains(name) {
                tool_router.disable_route(name.to_string());
            }
        }
        if pi.is_none() {
            tool_router.disable_route("request_capabilities".to_string());
        } else if let Some(bridge) = pi.as_ref() {
            if bridge.allowed_tool_count() == 0 {
                tool_router.disable_route("describe_pi_tool".to_string());
                tool_router.disable_route("execute_pi_tool".to_string());
            }
            let catalog = bridge
                .tools
                .iter()
                .filter(|tool| bridge.allowed_tool(&tool.name).is_some())
                .map(|tool| {
                    let one_line = tool
                        .description
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ");
                    let mut description = one_line.chars().take(120).collect::<String>();
                    if one_line.chars().count() > 120 {
                        description.push('…');
                    }
                    if description.is_empty() {
                        format!("- {}", tool.name)
                    } else {
                        format!("- {}: {}", tool.name, description)
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            if let Some(route) = tool_router.map.get_mut("request_capabilities") {
                route.attr.description = Some(
                    format!(
                        "Enable selected Pi tools or load Pi Skills on demand. Pi tools selected in Aura Settings are allowed but start inactive; successfully requested tools remain active for the current Pi session. Request only exact names that are missing from the current tool list.\n\nAllowed Pi tools:\n{}",
                        if catalog.is_empty() { "(none)" } else { &catalog }
                    )
                    .into(),
                );
            }
        }

        Self {
            app,
            tool_router,
            config,
            pi,
        }
    }

    fn fs_root(&self) -> &str {
        self.config
            .get("fsRoot")
            .and_then(Value::as_str)
            .unwrap_or("~/")
    }

    fn environment_path(&self) -> Option<&str> {
        configured_environment_path(&self.config)
    }

    fn pi_tool_schema(pi_tool: &crate::pi::PiTool) -> Value {
        serde_json::json!({
            "name": pi_tool.name,
            "description": pi_tool.description,
            "inputSchema": pi_tool.parameters,
        })
    }

    fn append_pi_tool_schemas(
        output: &mut Vec<String>,
        pi: &PiBridge,
        names: &[String],
        label: &str,
    ) {
        for name in names {
            if let Some(tool) = pi.allowed_tool(name) {
                output.push(format!(
                    "{label} Pi tool schema for {name}:\n{}",
                    Self::pi_tool_schema(&tool)
                ));
            }
        }
    }

    fn pi_tool_definition(bridge: &PiBridge, pi_tool: &crate::pi::PiTool) -> Tool {
        let description = format!(
            "{}\n\nSource: Pi {}{}",
            if pi_tool.description.is_empty() {
                "Pi tool."
            } else {
                &pi_tool.description
            },
            bridge.version,
            if pi_tool.uses_pi_default_model {
                " · May invoke the Pi default model."
            } else {
                " · Direct tool execution; no Pi agent turn."
            }
        );
        let schema = pi_tool.parameters.as_object().cloned().unwrap_or_default();
        Tool::new(pi_tool.name.clone(), description, schema)
    }

    async fn invoke_pi_tool(&self, name: &str, args: Value) -> CallToolResult {
        let started = std::time::Instant::now();
        let log_params = args.clone();
        let Some(bridge) = self.pi.as_ref() else {
            let error = "Pi bridge is unavailable.".to_string();
            self.log_execution(
                name,
                log_params,
                "Error",
                None,
                Some(error.clone()),
                started.elapsed().as_millis() as u64,
            );
            return CallToolResult::error(vec![ContentBlock::text(error)]);
        };

        match bridge.execute(name, args).await {
            Ok(result) => {
                let is_error = result
                    .get("isError")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let log_text = result
                    .get("logText")
                    .and_then(Value::as_str)
                    .map(bounded_log_text)
                    .unwrap_or_else(|| "(Non-text Pi result)".into());
                self.log_execution(
                    name,
                    log_params,
                    if is_error { "Error" } else { "Success" },
                    (!is_error).then(|| log_text.clone()),
                    is_error.then(|| log_text.clone()),
                    started.elapsed().as_millis() as u64,
                );
                let mut content = result
                    .get("content")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| {
                                serde_json::from_value::<ContentBlock>(item.clone()).ok()
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                if content.is_empty() {
                    content.push(ContentBlock::text(log_text));
                }
                if is_error {
                    CallToolResult::error(content)
                } else {
                    CallToolResult::success(content)
                }
            }
            Err(error) => {
                self.log_execution(
                    name,
                    log_params,
                    "Error",
                    None,
                    Some(error.clone()),
                    started.elapsed().as_millis() as u64,
                );
                CallToolResult::error(vec![ContentBlock::text(error)])
            }
        }
    }
}

#[tool_router(router = tool_router)]
impl AuraMcpServer {
    #[tool(description = "Read a UTF-8 file inside Aura Filesystem Root.")]
    async fn read_file(&self, Parameters(request): Parameters<ReadFileRequest>) -> String {
        let started = std::time::Instant::now();
        let result = match resolve_safe_path(self.fs_root(), &request.path)
            .and_then(|path| fs::read_to_string(path).map_err(|error| error.to_string()))
        {
            Ok(content) => Ok(content),
            Err(error) => Err(error),
        };
        let duration = started.elapsed().as_millis() as u64;
        match result {
            Ok(content) => {
                self.log_execution(
                    "read_file",
                    serde_json::json!({"path": request.path}),
                    "Success",
                    Some(bounded_log_text(&content)),
                    None,
                    duration,
                );
                content
            }
            Err(error) => {
                self.log_execution(
                    "read_file",
                    serde_json::json!({"path": request.path}),
                    "Error",
                    None,
                    Some(error.clone()),
                    duration,
                );
                format!("Error: {error}")
            }
        }
    }

    #[tool(description = "Create or overwrite a UTF-8 file inside Aura Filesystem Root.")]
    async fn write_file(&self, Parameters(request): Parameters<WriteFileRequest>) -> String {
        let started = std::time::Instant::now();
        let params = serde_json::json!({
            "path": request.path,
            "bytes": request.content.len()
        });
        let result = (|| -> Result<String, String> {
            let path = resolve_safe_write_path(self.fs_root(), &request.path)?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                security::resolve_existing_path(&expand_home(self.fs_root()), parent)?;
            }
            fs::write(&path, request.content.as_bytes()).map_err(|error| error.to_string())?;
            Ok(format!("Successfully wrote to {}", request.path))
        })();
        let duration = started.elapsed().as_millis() as u64;
        match result {
            Ok(message) => {
                self.log_execution(
                    "write_file",
                    params,
                    "Success",
                    Some(message.clone()),
                    None,
                    duration,
                );
                message
            }
            Err(error) => {
                self.log_execution(
                    "write_file",
                    params,
                    "Error",
                    None,
                    Some(error.clone()),
                    duration,
                );
                format!("Error: {error}")
            }
        }
    }

    #[tool(description = "Execute a shell command under Aura Shell Policy.")]
    async fn execute_shell(&self, Parameters(request): Parameters<ExecuteShellRequest>) -> String {
        let started = std::time::Instant::now();
        let command = request.command.trim().to_string();
        let policy = self
            .config
            .get("shellPolicy")
            .and_then(Value::as_str)
            .unwrap_or("unrestricted")
            .to_string();
        let params = serde_json::json!({"command": command, "policy": policy});
        let allowlist = self
            .config
            .get("shellAllowlist")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(ToOwned::to_owned)
            .collect::<HashSet<_>>();
        let denylist = self
            .config
            .get("shellDenylist")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(ToOwned::to_owned)
            .collect::<HashSet<_>>();
        if let Err(error) =
            security::validate_shell_policy(&command, &policy, &allowlist, &denylist)
        {
            self.log_execution(
                "execute_shell",
                params,
                "Error",
                None,
                Some(error.clone()),
                started.elapsed().as_millis() as u64,
            );
            return format!("Error: {error}");
        }

        #[cfg(target_os = "windows")]
        let mut process = {
            let mut process = Command::new("cmd.exe");
            process.args(["/C", &command]);
            if let Some(path) = self.environment_path() {
                process.env("PATH", path);
            }
            process
        };
        #[cfg(not(target_os = "windows"))]
        let mut process = {
            let mut process = Command::new("/bin/sh");
            let shell_command = if let Some(path) = self.environment_path() {
                process.env("AURA_RUNTIME_PATH", path);
                format!("export PATH=\"$AURA_RUNTIME_PATH\"; unset AURA_RUNTIME_PATH; {command}")
            } else {
                command.clone()
            };
            process.args(["-lc", &shell_command]);
            process
        };
        process.current_dir(home_dir());
        match process.output().await {
            Ok(output) => {
                let mut text = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr);
                if !stderr.trim().is_empty() {
                    if !text.is_empty() {
                        text.push('\n');
                    }
                    text.push_str("STDERR:\n");
                    text.push_str(&stderr);
                }
                let is_error = !output.status.success();
                if is_error {
                    text.push_str(&format!("\nERROR: process exited with {}", output.status));
                }
                let text = if text.trim().is_empty() {
                    "Command executed successfully with no output.".to_string()
                } else {
                    text.trim().to_string()
                };
                self.log_execution(
                    "execute_shell",
                    params,
                    if is_error { "Error" } else { "Success" },
                    Some(bounded_log_text(&text)),
                    is_error.then(|| format!("process exited with {}", output.status)),
                    started.elapsed().as_millis() as u64,
                );
                text
            }
            Err(error) => {
                let error = error.to_string();
                self.log_execution(
                    "execute_shell",
                    params,
                    "Error",
                    None,
                    Some(error.clone()),
                    started.elapsed().as_millis() as u64,
                );
                format!("Error: {error}")
            }
        }
    }

    #[tool(description = "List reusable Skills available to Aura.")]
    async fn list_skills(&self) -> String {
        let started = std::time::Instant::now();
        let output = if let Some(pi) = self.pi.as_ref() {
            if pi.skills.is_empty() {
                "(No Pi Skills discovered.)".into()
            } else {
                pi.skills
                    .iter()
                    .map(|skill| {
                        let source = skill
                            .source_info
                            .as_ref()
                            .and_then(|value| value.get("source").or_else(|| value.get("path")))
                            .and_then(Value::as_str)
                            .unwrap_or("pi");
                        format!(
                            "- {}: {}\n  source: {}\n  directory: {}",
                            skill.name,
                            if skill.description.is_empty() {
                                "No description provided."
                            } else {
                                &skill.description
                            },
                            source,
                            skill.base_dir
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        } else {
            let discovered = skills::discover(self.fs_root());
            if discovered.is_empty() {
                "(No local Skills discovered.)".into()
            } else {
                discovered
                    .into_iter()
                    .map(|skill| {
                        format!(
                            "- {}: {}\n  source: {}\n  directory: {}",
                            skill.name,
                            if skill.description.is_empty() {
                                "No description provided."
                            } else {
                                &skill.description
                            },
                            skill.source,
                            skill.dir.display()
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        };
        self.log_execution(
            "list_skills",
            serde_json::json!({}),
            "Success",
            Some(bounded_log_text(&output)),
            None,
            started.elapsed().as_millis() as u64,
        );
        output
    }

    #[tool(description = "Read SKILL.md or another text file inside a selected Skill directory.")]
    async fn read_skill(&self, Parameters(request): Parameters<ReadSkillRequest>) -> String {
        let started = std::time::Instant::now();
        let params = serde_json::json!({"skill": request.skill, "path": request.path});
        let result = if let Some(pi) = self.pi.as_ref() {
            pi.read_skill(&request.skill, &request.path)
        } else {
            skills::read(self.fs_root(), &request.skill, &request.path)
        };
        match result {
            Ok(content) => {
                self.log_execution(
                    "read_skill",
                    params,
                    "Success",
                    Some(bounded_log_text(&content)),
                    None,
                    started.elapsed().as_millis() as u64,
                );
                content
            }
            Err(error) => {
                self.log_execution(
                    "read_skill",
                    params,
                    "Error",
                    None,
                    Some(error.clone()),
                    started.elapsed().as_millis() as u64,
                );
                format!("Error: {error}")
            }
        }
    }

    #[tool(
        description = "Describe one active Pi tool, including its original input schema. The tool must be selected in Aura Settings and activated with request_capabilities first.",
        annotations(
            title = "Describe active Pi tool",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn describe_pi_tool(
        &self,
        Parameters(request): Parameters<DescribePiToolRequest>,
    ) -> String {
        let name = request.name.trim();
        let Some(pi) = self.pi.as_ref() else {
            return "Error: Pi bridge is unavailable.".into();
        };
        let Some(tool) = pi.allowed_tool(name) else {
            return format!("Error: Pi tool '{name}' is not enabled in Aura Settings.");
        };
        match pi.active_tool_names().await {
            Ok(active) if active.contains(name) => serde_json::json!({
                "name": tool.name,
                "description": tool.description,
                "inputSchema": tool.parameters,
                "source": format!("Pi {}", pi.version),
            })
            .to_string(),
            Ok(_) => {
                format!("Error: Pi tool '{name}' is inactive. Call request_capabilities first.")
            }
            Err(error) => format!("Error: Unable to read active Pi tools: {error}"),
        }
    }

    #[tool(
        description = "Execute one active Pi tool through Aura's ChatGPT compatibility path. The tool must be selected in Aura Settings and activated with request_capabilities first. Aura still enforces the original Pi tool, Filesystem Root, and Shell Policy checks. Use describe_pi_tool to inspect its input schema."
    )]
    async fn execute_pi_tool(
        &self,
        Parameters(request): Parameters<ExecutePiToolRequest>,
    ) -> CallToolResult {
        let name = request.name.trim();
        let arguments = if request.arguments.is_null() {
            Value::Object(Default::default())
        } else if request.arguments.is_object() {
            request.arguments
        } else {
            return CallToolResult::error(vec![ContentBlock::text(
                "Pi tool arguments must be a JSON object.",
            )]);
        };
        let Some(pi) = self.pi.as_ref() else {
            return CallToolResult::error(vec![ContentBlock::text("Pi bridge is unavailable.")]);
        };
        match pi.active_tool_names().await {
            Ok(active) if active.contains(name) => self.invoke_pi_tool(name, arguments).await,
            Ok(_) if pi.allowed_tool(name).is_some() => {
                CallToolResult::error(vec![ContentBlock::text(format!(
                    "Pi tool '{name}' is inactive. Call request_capabilities first."
                ))])
            }
            Ok(_) => CallToolResult::error(vec![ContentBlock::text(format!(
                "Pi tool '{name}' is not enabled in Aura Settings."
            ))]),
            Err(error) => CallToolResult::error(vec![ContentBlock::text(format!(
                "Unable to read active Pi tools: {error}"
            ))]),
        }
    }

    #[tool(
        description = "Enable selected Pi tools or load Pi Skills on demand. Tools must be allowed in Aura Settings."
    )]
    async fn request_capabilities(
        &self,
        Parameters(request): Parameters<RequestCapabilitiesRequest>,
    ) -> String {
        let started = std::time::Instant::now();
        let tools = request.tools.into_iter().take(16).collect::<Vec<_>>();
        let skills = request.skills.into_iter().take(16).collect::<Vec<_>>();
        let reason = request.reason.filter(|value| !value.trim().is_empty());
        let params = serde_json::json!({"tools": tools, "skills": skills, "reason": reason});
        let Some(pi) = self.pi.as_ref() else {
            let error = "Pi bridge is unavailable.".to_string();
            self.log_execution(
                "request_capabilities",
                params,
                "Error",
                None,
                Some(error.clone()),
                started.elapsed().as_millis() as u64,
            );
            return format!("Error: {error}");
        };

        let activation = match pi.enable_tools(&tools).await {
            Ok(activation) => activation,
            Err(error) => {
                self.log_execution(
                    "request_capabilities",
                    params,
                    "Error",
                    None,
                    Some(error.clone()),
                    started.elapsed().as_millis() as u64,
                );
                return format!("Error: {error}");
            }
        };

        let mut output = Vec::new();
        if let Some(reason) = reason.as_ref() {
            output.push(format!("Reason: {reason}"));
        }
        if !activation.enabled.is_empty() {
            output.push(format!(
                "Enabled Pi tools: {}",
                activation.enabled.join(", ")
            ));
            Self::append_pi_tool_schemas(&mut output, pi, &activation.enabled, "Activated");
        }
        if !activation.already_active.is_empty() {
            output.push(format!(
                "Already active: {}",
                activation.already_active.join(", ")
            ));
            Self::append_pi_tool_schemas(&mut output, pi, &activation.already_active, "Active");
        }
        if !activation.blocked.is_empty() {
            output.push(format!(
                "Blocked by Aura Settings: {}",
                activation.blocked.join(", ")
            ));
        }
        if !activation.unknown.is_empty() {
            output.push(format!(
                "Unknown Pi tools: {}",
                activation.unknown.join(", ")
            ));
        }
        for name in &skills {
            match pi.read_skill(name, "SKILL.md") {
                Ok(content) => {
                    output.push(format!("<skill name=\"{}\">\n{}\n</skill>", name, content))
                }
                Err(error) => output.push(format!("Skill {name}: {error}")),
            }
        }
        let output = if output.is_empty() {
            "No capability changes were required.".into()
        } else {
            output.join("\n\n")
        };
        self.log_execution(
            "request_capabilities",
            params,
            "Success",
            Some(bounded_log_text(&output)),
            None,
            started.elapsed().as_millis() as u64,
        );
        output
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for AuraMcpServer {
    async fn call_tool(
        &self,
        request: rmcp::model::CallToolRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::CallToolResponse, rmcp::ErrorData> {
        let collector = context
            .extensions
            .get::<axum::http::request::Parts>()
            .and_then(|parts| {
                parts
                    .extensions
                    .get::<crate::http_logger::McpLogCollector>()
            })
            .cloned();

        crate::http_logger::scope_mcp_log_collector(collector, async move {
            let name = request.name.to_string();
            if self.tool_router.has_route(&name) {
                let before = if name == "request_capabilities" {
                    match self.pi.as_ref() {
                        Some(pi) => pi.active_tool_names().await.ok(),
                        None => None,
                    }
                } else {
                    None
                };
                let peer = context.peer.clone();
                let result = self
                    .tool_router
                    .call(ToolCallContext::new(self, request, context))
                    .await?;

                if let (Some(before), Some(pi)) = (before, self.pi.as_ref()) {
                    if let Ok(after) = pi.active_tool_names().await {
                        if after != before {
                            if let Err(error) = peer.notify_tool_list_changed().await {
                                if let Some(app) = &self.app {
                                    emit_runtime(
                                        app,
                                        "warn",
                                        &format!(
                                            "Unable to notify MCP client of Pi tool changes: {error}"
                                        ),
                                    );
                                }
                            }
                        }
                    }
                }
                return Ok(result);
            }

            if let Some(pi) = self.pi.as_ref() {
                if pi.allowed_tool(&name).is_some() {
                    let args = Value::Object(request.arguments.unwrap_or_default());
                    return Ok(self.invoke_pi_tool(&name, args).await.into());
                }
            }

            Err(rmcp::ErrorData::invalid_params("tool not found", None))
        })
        .await
    }

    async fn list_tools(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::ListToolsResult, rmcp::ErrorData> {
        let supports_cache_hints = context
            .protocol_version()
            .is_some_and(|version| version >= rmcp::model::ProtocolVersion::V_2026_07_28);
        let mut tools = self.tool_router.list_all();
        if let Some(pi) = self.pi.as_ref() {
            let active = pi.visible_tools().await.map_err(|error| {
                rmcp::ErrorData::internal_error(
                    format!("Unable to read active Pi tools: {error}"),
                    None,
                )
            })?;
            tools.extend(active.iter().map(|tool| Self::pi_tool_definition(pi, tool)));
        }
        tools.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(rmcp::model::ListToolsResult {
            result_type: Some(rmcp::model::ResultType::COMPLETE),
            tools,
            meta: None,
            next_cursor: None,
            ttl_ms: supports_cache_hints.then_some(0),
            cache_scope: supports_cache_hints.then_some(rmcp::model::CacheScope::Public),
        })
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        if let Some(tool) = self.tool_router.get(name) {
            return Some(tool.clone());
        }
        let pi = self.pi.as_ref()?;
        pi.allowed_tool(name)
            .map(|tool| Self::pi_tool_definition(pi, &tool))
    }

    fn get_info(&self) -> ServerInfo {
        let instructions = self
            .config
            .get("mcpInstructions")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_tool_list_changed()
                .build(),
        )
        .with_server_info(Implementation::new("Aura-MCP", "1.0.1"))
        .with_instructions(instructions)
    }
}

struct RuntimeInner {
    running: bool,
    starting: bool,
    startup_cancel: Option<CancellationToken>,
    server_cancel: Option<CancellationToken>,
    server_task: Option<JoinHandle<()>>,
    tunnel: Option<Child>,
    pi: Option<Arc<PiBridge>>,
}

pub struct RuntimeManager {
    inner: Mutex<RuntimeInner>,
    pi_init: Mutex<()>,
    pub auth: Arc<AuthStore>,
}

fn loopback_listen_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host == "[::1]"
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}

fn build_allowed_hosts(effective: &Value) -> Vec<String> {
    let mut hosts = HashSet::new();
    hosts.insert("localhost".to_string());
    hosts.insert("127.0.0.1".to_string());
    hosts.insert("::1".to_string());
    hosts.insert("[::1]".to_string());

    let listen_host = effective
        .get("listenHost")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if !listen_host.is_empty() && listen_host != "0.0.0.0" && listen_host != "::" {
        hosts.insert(listen_host.to_string());
    }

    if let Some(mcp_url) = effective.get("mcpUrl").and_then(Value::as_str) {
        if let Ok(parsed) = Url::parse(mcp_url.trim()) {
            if let Some(host) = parsed.host_str() {
                let host = host.trim().to_ascii_lowercase();
                if !host.is_empty() {
                    hosts.insert(host);
                }
            }
        }
    }

    hosts.into_iter().collect()
}

impl RuntimeManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(RuntimeInner {
                running: false,
                starting: false,
                startup_cancel: None,
                server_cancel: None,
                server_task: None,
                tunnel: None,
                pi: None,
            }),
            pi_init: Mutex::new(()),
            auth: Arc::new(AuthStore::load()),
        }
    }

    pub async fn is_running(&self) -> bool {
        self.inner.lock().await.running
    }

    pub async fn start(&self, app: &AppHandle) -> Result<bool, String> {
        let startup_token = CancellationToken::new();

        loop {
            let should_wait = {
                let mut inner = self.inner.lock().await;
                if inner.running {
                    return Ok(true);
                }
                if inner.starting {
                    if let Some(cancel) = &inner.startup_cancel {
                        cancel.cancel();
                    }
                    true
                } else {
                    inner.starting = true;
                    inner.startup_cancel = Some(startup_token.clone());
                    false
                }
            };
            if !should_wait {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        let result = async {
            let mut stored_config = config::load();
            ensure_environment_path(app, &mut stored_config).await;
            let effective = config::effective(&stored_config, None);
            let host = effective
                .get("listenHost")
                .and_then(Value::as_str)
                .unwrap_or("127.0.0.1")
                .to_string();
            let port = effective
                .get("listenPort")
                .and_then(Value::as_u64)
                .unwrap_or(3000) as u16;
            let mcp_path = effective
                .get("mcpPath")
                .and_then(Value::as_str)
                .unwrap_or("/mcp")
                .to_string();
            let mode = effective
                .get("tunnelMode")
                .and_then(Value::as_str)
                .unwrap_or("cloudflare-named")
                .to_string();
            if mode == "openai" && !loopback_listen_host(&host) {
                return Err(
                    "OpenAI Secure Tunnel mode requires Aura MCP to listen on a loopback address."
                        .into(),
                );
            }

            emit_runtime(
                app,
                "info",
                &format!("Starting Aura MCP on {host}:{port}{mcp_path}"),
            );

            let pi = if effective
                .get("piEnabled")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                let _init_guard = self.pi_init.lock().await;
                let bridge = tokio::select! {
                    _ = startup_token.cancelled() => {
                        return Err("Aura startup cancelled.".to_string());
                    }
                    result = PiBridge::initialize(&effective) => {
                        result.map_err(|error| format!("Pi bridge initialization failed: {error}"))?
                    }
                };
                let bridge = Arc::new(bridge);
                emit_runtime(
                    app,
                    "info",
                    &format!(
                        "Pi bridge ready: {} tools, {} skills (Pi {}, Node {}).",
                        bridge.allowed_tool_count(),
                        bridge.skills.len(),
                        bridge.version,
                        bridge.node_version
                    ),
                );
                Some(bridge)
            } else {
                None
            };

            if startup_token.is_cancelled() {
                return Err("Aura startup cancelled.".into());
            }

            let allowed_hosts = build_allowed_hosts(&effective);
            let stream_config = StreamableHttpServerConfig::default()
                .with_legacy_session_mode(true)
                .with_json_response(false)
                .with_allowed_hosts(allowed_hosts);
            let server_config = effective.clone();
            let server_pi = pi.clone();
            let mcp_service: StreamableHttpService<AuraMcpServer, LocalSessionManager> =
                StreamableHttpService::new(
                    {
                        let app = app.clone();
                        move || {
                            Ok(AuraMcpServer::new(
                                Some(app.clone()),
                                server_config.clone(),
                                server_pi.clone(),
                            ))
                        }
                    },
                    Default::default(),
                    stream_config,
                );

            let web_state = Arc::new(WebState {
                auth: self.auth.clone(),
                mode: mode.clone(),
                resource_url: resource_url_from_config(&effective, &mcp_path),
                admin_secret_marker: effective
                    .get("adminSecret")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
            });
            let http_logger_state = Some(app.clone());
            let protected = Router::new()
                .nest_service(&mcp_path, mcp_service)
                .layer(middleware::from_fn_with_state(
                    http_logger_state,
                    crate::http_logger::log_http_request,
                ))
                .route_layer(middleware::from_fn_with_state(
                    web_state.clone(),
                    authorize_mcp,
                ));
            let oauth = oauth_router(web_state.clone(), &mcp_path);
            let router = Router::new()
                .merge(oauth)
                .merge(protected)
                .layer(CorsLayer::permissive());

            if startup_token.is_cancelled() {
                return Err("Aura startup cancelled.".into());
            }

            let address: SocketAddr = format!("{host}:{port}")
                .parse()
                .map_err(|error| format!("Invalid listen address: {error}"))?;
            let listener = tokio::net::TcpListener::bind(address)
                .await
                .map_err(|error| format!("Failed to listen on {address}: {error}"))?;
            let cancel = CancellationToken::new();
            let server_cancel = cancel.clone();
            let app_for_server = app.clone();
            let task = tokio::spawn(async move {
                if let Err(error) = axum::serve(listener, router)
                    .with_graceful_shutdown(server_cancel.cancelled_owned())
                    .await
                {
                    emit_runtime(
                        &app_for_server,
                        "error",
                        &format!("MCP server stopped: {error}"),
                    );
                }
            });

            let tunnel_result = tokio::select! {
                _ = startup_token.cancelled() => {
                    Err("Aura startup cancelled.".to_string())
                }
                result = start_tunnel(app, &effective) => {
                    result.map_err(|error| format!("Failed to start tunnel: {error}"))
                }
            };
            let mut tunnel = match tunnel_result {
                Ok(tunnel) => tunnel,
                Err(error) => {
                    cancel.cancel();
                    let _ = task.await;
                    return Err(error);
                }
            };

            if startup_token.is_cancelled() {
                cancel.cancel();
                if let Some(child) = tunnel.as_mut() {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                }
                let _ = task.await;
                return Err("Aura startup cancelled.".into());
            }

            Ok::<_, String>((cancel, task, tunnel, pi))
        }
        .await;

        match result {
            Ok((cancel, task, mut tunnel, pi)) => {
                if startup_token.is_cancelled() {
                    cancel.cancel();
                    if let Some(child) = tunnel.as_mut() {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                    }
                    let _ = task.await;
                    if let Some(pi) = pi {
                        pi.shutdown().await;
                    }
                    let mut inner = self.inner.lock().await;
                    inner.running = false;
                    inner.starting = false;
                    inner.startup_cancel = None;
                    drop(inner);
                    let _ = app.emit("service-state-changed", false);
                    emit_runtime(app, "warn", "Aura startup was cancelled.");
                    return Err("Aura startup cancelled.".into());
                }

                let mut inner = self.inner.lock().await;
                inner.server_cancel = Some(cancel);
                inner.server_task = Some(task);
                inner.tunnel = tunnel;
                inner.pi = pi;
                inner.running = true;
                inner.starting = false;
                inner.startup_cancel = None;
                drop(inner);
                let _ = app.emit("service-state-changed", true);
                emit_runtime(app, "info", "Aura MCP services are running.");
                Ok(true)
            }
            Err(error) => {
                let mut inner = self.inner.lock().await;
                inner.running = false;
                inner.starting = false;
                inner.startup_cancel = None;
                drop(inner);
                let _ = app.emit("service-state-changed", false);
                if error != "Aura startup cancelled." {
                    emit_runtime(app, "error", &format!("Aura startup failed: {error}"));
                } else {
                    emit_runtime(app, "warn", "Aura startup was cancelled.");
                }
                Err(error)
            }
        }
    }

    pub async fn stop(&self, app: &AppHandle) -> Result<bool, String> {
        let (cancel, task, mut tunnel, pi) = {
            let mut inner = self.inner.lock().await;
            if inner.starting {
                if let Some(cancel) = inner.startup_cancel.take() {
                    cancel.cancel();
                }
            }
            if !inner.running {
                return Ok(false);
            }
            inner.running = false;
            (
                inner.server_cancel.take(),
                inner.server_task.take(),
                inner.tunnel.take(),
                inner.pi.take(),
            )
        };
        if let Some(cancel) = cancel {
            cancel.cancel();
        }
        if let Some(mut child) = tunnel.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        if let Some(task) = task {
            let _ = task.await;
        }
        if let Some(pi) = pi {
            pi.shutdown().await;
        }
        let _ = app.emit("service-state-changed", false);
        emit_runtime(app, "info", "Aura MCP services stopped.");
        Ok(false)
    }

    pub async fn pi_capabilities(&self) -> Value {
        let cfg = config::effective(&config::load(), None);
        // Do not return disabled just because it's turned off in settings,
        // the user is trying to inspect the available tools in the UI.

        let existing = self.inner.lock().await.pi.clone();
        if let Some(pi) = existing {
            return pi_capabilities_value(&pi);
        }

        let _init_guard = self.pi_init.lock().await;
        let recheck = self.inner.lock().await.pi.clone();
        if let Some(pi) = recheck {
            return pi_capabilities_value(&pi);
        }

        // Temporarily instantiate to probe tools
        match PiBridge::initialize(&cfg).await {
            Ok(pi) => {
                let val = pi_capabilities_value(&pi);
                pi.shutdown().await;
                val
            }
            Err(error) => json!({
                "available": false,
                "version": null,
                "tools": [],
                "error": error
            }),
        }
    }

    pub async fn restart(&self, app: &AppHandle) -> Result<bool, String> {
        if self.is_running().await {
            self.stop(app).await?;
        }
        self.start(app).await
    }
}

fn pi_capabilities_value(pi: &PiBridge) -> Value {
    json!({
        "available": true,
        "version": pi.version,
        "tools": pi.tools.as_ref(),
        "error": null
    })
}

fn oauth_router(state: Arc<WebState>, mcp_path: &str) -> Router {
    let protected_with_path = format!("/.well-known/oauth-protected-resource{mcp_path}");
    let auth_with_path = format!("/.well-known/oauth-authorization-server{mcp_path}");
    let mcp_protected = format!("{mcp_path}/.well-known/oauth-protected-resource");
    let mcp_auth = format!("{mcp_path}/.well-known/oauth-authorization-server");
    let mcp_openid = format!("{mcp_path}/.well-known/openid-configuration");
    let register = format!("{mcp_path}/oauth/register");
    let authorize = format!("{mcp_path}/oauth/authorize");
    let token = format!("{mcp_path}/oauth/token");

    Router::new()
        .route(&protected_with_path, get(protected_metadata_handler))
        .route(&auth_with_path, get(authorization_metadata_handler))
        .route(&mcp_protected, get(protected_metadata_handler))
        .route(&mcp_auth, get(authorization_metadata_handler))
        .route(
            "/.well-known/oauth-protected-resource",
            get(protected_metadata_handler),
        )
        .route(
            "/.well-known/oauth-authorization-server",
            get(authorization_metadata_handler),
        )
        .route(&mcp_openid, get(authorization_metadata_handler))
        .route(
            "/.well-known/openid-configuration",
            get(authorization_metadata_handler),
        )
        .route(&register, post(register_client))
        .route(&authorize, get(authorize_get).post(authorize_post))
        .route(&token, post(token_exchange))
        .with_state(state)
}

pub(crate) fn emit_runtime(app: &AppHandle, level: &str, message: &str) {
    let entry = json!({
        "timestamp": now_ms(),
        "level": level,
        "source": "App",
        "message": message,
        "detail": null
    });
    push_recent_log("runtime", &entry);
    let _ = app.emit("runtime-log", entry);
}

fn emit_tunnel(app: &AppHandle, level: &str, message: &str) {
    let _ = app.emit(
        "tunnel-log",
        json!({
            "timestamp": now_ms(),
            "level": level,
            "source": "Tunnel",
            "message": message,
            "detail": null
        }),
    );
}

fn is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn executable_name(mode: &str) -> &'static str {
    #[cfg(target_os = "windows")]
    {
        if mode == "openai" {
            "tunnel-client.exe"
        } else {
            "cloudflared.exe"
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if mode == "openai" {
            "tunnel-client"
        } else {
            "cloudflared"
        }
    }
}

fn locate_binary(mode: &str, configured: &str, environment_path: Option<&str>) -> Option<PathBuf> {
    if !configured.trim().is_empty() {
        let path = expand_home(configured);
        if is_executable(&path) {
            return Some(path);
        }
    }
    let name = executable_name(mode);
    let path_value = environment_path
        .map(std::ffi::OsString::from)
        .or_else(|| env::var_os("PATH"))
        .unwrap_or_default();
    let mut candidates = env::split_paths(&path_value)
        .map(|dir| dir.join(name))
        .collect::<Vec<_>>();
    #[cfg(target_os = "macos")]
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin").join(name),
        PathBuf::from("/usr/local/bin").join(name),
        home_dir().join(".local/bin").join(name),
    ]);
    #[cfg(target_os = "linux")]
    candidates.extend([
        PathBuf::from("/usr/local/bin").join(name),
        PathBuf::from("/usr/bin").join(name),
        PathBuf::from("/snap/bin").join(name),
        home_dir().join(".local/bin").join(name),
    ]);
    #[cfg(target_os = "windows")]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join(name));
        }
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join(name));
        }
    }
    candidates.into_iter().find(|path| is_executable(path))
}

fn local_origin_host(host: &str) -> &str {
    if host == "0.0.0.0" || host == "::" {
        "127.0.0.1"
    } else {
        host
    }
}

fn apply_cloudflare_ingress_override(effective: &Value) -> Result<(), String> {
    let config_path = effective
        .get("cfConfigPath")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mcp_url = effective
        .get("mcpUrl")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if config_path.trim().is_empty() || mcp_url.trim().is_empty() {
        return Ok(());
    }
    let hostname = Url::parse(mcp_url)
        .ok()
        .and_then(|url| url.host_str().map(ToOwned::to_owned))
        .unwrap_or_default();
    if hostname.is_empty() || hostname == "mcp.yourdomain.com" {
        return Ok(());
    }
    let path = expand_home(config_path);
    let source = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut yaml: serde_yaml::Value =
        serde_yaml::from_str(&source).map_err(|error| error.to_string())?;
    let Some(ingress) = yaml
        .get_mut("ingress")
        .and_then(serde_yaml::Value::as_sequence_mut)
    else {
        return Err("Cloudflare config has no valid ingress rules.".into());
    };
    let host = effective
        .get("listenHost")
        .and_then(Value::as_str)
        .unwrap_or("127.0.0.1");
    let port = effective
        .get("listenPort")
        .and_then(Value::as_u64)
        .unwrap_or(3000);
    let service = format!("http://{}:{port}", local_origin_host(host));
    let mut changed = false;
    for rule in ingress {
        let Some(map) = rule.as_mapping_mut() else {
            continue;
        };
        let key = serde_yaml::Value::String("hostname".into());
        if map.get(&key).and_then(serde_yaml::Value::as_str) != Some(hostname.as_str()) {
            continue;
        }
        let service_key = serde_yaml::Value::String("service".into());
        if map.get(&service_key).and_then(serde_yaml::Value::as_str) != Some(service.as_str()) {
            map.insert(service_key, serde_yaml::Value::String(service.clone()));
            changed = true;
        }
        break;
    }
    if changed {
        let backup = PathBuf::from(format!("{}.aura-backup", path.display()));
        if !backup.exists() {
            let _ = fs::copy(&path, &backup);
        }
        fs::write(
            &path,
            serde_yaml::to_string(&yaml).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn tunnel_line_is_ready(mode: &str, line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    match mode {
        "cloudflare-named" => lower.contains("registered tunnel connection"),
        "cloudflare-quick" => lower.contains("https://") && lower.contains(".trycloudflare.com"),
        "openai" => {
            lower.contains("connected") || lower.contains("registered") || lower.contains("ready")
        }
        _ => true,
    }
}

async fn wait_for_tunnel_ready(
    child: &mut Child,
    mode: &str,
    mut startup_rx: mpsc::UnboundedReceiver<String>,
) -> Result<(), String> {
    let timeout = match mode {
        "cloudflare-quick" => Duration::from_secs(20),
        "cloudflare-named" => Duration::from_secs(15),
        "openai" => Duration::from_secs(5),
        _ => Duration::from_secs(2),
    };
    let started = tokio::time::Instant::now();
    let openai_stable_after = Duration::from_millis(1800);

    loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(format!(
                "{mode} tunnel exited before becoming ready: {status}"
            ));
        }

        if mode == "openai" && started.elapsed() >= openai_stable_after {
            return Ok(());
        }
        if started.elapsed() >= timeout {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(format!(
                "{mode} tunnel did not become ready within {} seconds.",
                timeout.as_secs()
            ));
        }

        match tokio::time::timeout(Duration::from_millis(200), startup_rx.recv()).await {
            Ok(Some(line)) if tunnel_line_is_ready(mode, &line) => return Ok(()),
            Ok(Some(_)) | Err(_) => {}
            Ok(None) => {
                if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                    return Err(format!(
                        "{mode} tunnel exited before becoming ready: {status}"
                    ));
                }
            }
        }
    }
}

async fn start_tunnel(app: &AppHandle, effective: &Value) -> Result<Option<Child>, String> {
    let mode = effective
        .get("tunnelMode")
        .and_then(Value::as_str)
        .unwrap_or("cloudflare-named");
    if mode == "custom" {
        return Ok(None);
    }
    let configured = effective
        .get("binaryPath")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let environment_path = configured_environment_path(effective);
    let binary = locate_binary(mode, configured, environment_path).ok_or_else(|| {
        format!(
            "{} executable not found. Configure Binary File Path in Network & Tunnel.",
            executable_name(mode)
        )
    })?;
    let host = effective
        .get("listenHost")
        .and_then(Value::as_str)
        .unwrap_or("127.0.0.1");
    let port = effective
        .get("listenPort")
        .and_then(Value::as_u64)
        .unwrap_or(3000);
    let mcp_path = effective
        .get("mcpPath")
        .and_then(Value::as_str)
        .unwrap_or("/mcp");
    let mut command = Command::new(&binary);
    if let Some(path) = environment_path {
        command.env("PATH", path);
    }

    match mode {
        "cloudflare-named" => {
            if let Err(error) = apply_cloudflare_ingress_override(effective) {
                emit_tunnel(
                    app,
                    "warn",
                    &format!("Cloudflare ingress update skipped: {error}"),
                );
            }
            command.arg("tunnel");
            let config_path = effective
                .get("cfConfigPath")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !config_path.trim().is_empty() {
                let expanded_cf = expand_home(config_path.trim());
                command.arg("--config").arg(expanded_cf);
            }
            command.arg("run");
        }
        "cloudflare-quick" => {
            command.args([
                "tunnel",
                "--url",
                &format!("http://{}:{port}", local_origin_host(host)),
            ]);
        }
        "openai" => {
            let target = format!("http://{}:{port}{mcp_path}", local_origin_host(host));
            command.args([
                "run",
                "--mcp.server-url",
                &format!("url={target}"),
                "--health.listen-addr",
                "127.0.0.1:0",
                "--log.format",
                "struct-text",
                "--log.level",
                "info",
            ]);
            if let Some(tunnel_id) = effective
                .get("tunnelId")
                .and_then(Value::as_str)
                .filter(|v| !v.trim().is_empty())
            {
                command.args(["--control-plane.tunnel-id", tunnel_id.trim()]);
            }
            if let Some(key) = effective
                .get("tunnelApiKey")
                .and_then(Value::as_str)
                .filter(|v| !v.trim().is_empty())
            {
                command.env("CONTROL_PLANE_API_KEY", key.trim());
                command.env("OPENAI_API_KEY", key.trim());
            }
        }
        _ => return Ok(None),
    }

    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    emit_tunnel(
        app,
        "info",
        &format!("Starting {} ({})", mode, binary.display()),
    );

    let (startup_tx, startup_rx) = mpsc::unbounded_channel();
    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        let mode = mode.to_string();
        let startup_tx = startup_tx.clone();
        tokio::spawn(async move { pipe_tunnel_output(stdout, app, mode, Some(startup_tx)).await });
    }
    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        let mode = mode.to_string();
        let startup_tx = startup_tx.clone();
        tokio::spawn(async move { pipe_tunnel_output(stderr, app, mode, Some(startup_tx)).await });
    }
    drop(startup_tx);

    wait_for_tunnel_ready(&mut child, mode, startup_rx).await?;
    emit_tunnel(app, "info", &format!("{mode} tunnel is ready."));
    Ok(Some(child))
}

async fn pipe_tunnel_output<R>(
    reader: R,
    app: AppHandle,
    mode: String,
    startup_tx: Option<mpsc::UnboundedSender<String>>,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(tx) = startup_tx.as_ref() {
            let _ = tx.send(trimmed.to_string());
        }
        let lower = trimmed.to_ascii_lowercase();
        let level = if lower.contains("error") || lower.contains("failed") {
            "error"
        } else if lower.contains("warn") {
            "warn"
        } else {
            "info"
        };
        emit_tunnel(&app, level, trimmed);

        if mode == "cloudflare-quick" {
            if let Some(url) = trimmed
                .split_whitespace()
                .map(|part| {
                    part.trim_matches(|c: char| !c.is_ascii_alphanumeric() && !":/.-_".contains(c))
                })
                .find(|part| part.starts_with("https://") && part.ends_with(".trycloudflare.com"))
            {
                let mut cfg = config::load();
                cfg = config::update_provider(cfg, "cloudflare-quick", &json!({"mcpUrl": url}));
                let _ = config::write(&cfg);
                let _ = app.emit("url-updated", url.to_string());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    async fn send_raw_http(
        addr: SocketAddr,
        method: &str,
        path: &str,
        host: &str,
        headers: &[(&str, &str)],
        body: &str,
    ) -> (u16, HashMap<String, String>, String) {
        let mut stream = TcpStream::connect(addr)
            .await
            .expect("Failed to connect to local test server");

        let mut request =
            format!("{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n");
        for (k, v) in headers {
            request.push_str(&format!("{k}: {v}\r\n"));
        }
        if !body.is_empty() {
            request.push_str(&format!("Content-Length: {}\r\n", body.len()));
        }
        request.push_str("\r\n");
        request.push_str(body);

        stream
            .write_all(request.as_bytes())
            .await
            .expect("Failed to write request");
        stream.flush().await.expect("Failed to flush request");

        let mut response_bytes = Vec::new();
        stream
            .read_to_end(&mut response_bytes)
            .await
            .expect("Failed to read response");
        let response_str = String::from_utf8_lossy(&response_bytes).to_string();

        let mut parts = response_str.splitn(2, "\r\n\r\n");
        let header_part = parts.next().unwrap_or("");
        let body_part = parts.next().unwrap_or("").to_string();

        let mut lines = header_part.lines();
        let status_line = lines.next().unwrap_or("");
        let status_code = status_line
            .split_whitespace()
            .nth(1)
            .and_then(|c| c.parse::<u16>().ok())
            .unwrap_or(0);

        let mut res_headers = HashMap::new();
        for line in lines {
            if let Some((k, v)) = line.split_once(':') {
                res_headers.insert(k.trim().to_lowercase(), v.trim().to_string());
            }
        }

        (status_code, res_headers, body_part)
    }

    fn embedded_schema_from_output(output: &str, label: &str, name: &str) -> Value {
        let marker = format!("{label} Pi tool schema for {name}:\n");
        let json = output
            .split_once(&marker)
            .unwrap_or_else(|| panic!("missing embedded schema marker: {marker}"))
            .1
            .split("\n\n")
            .next()
            .expect("embedded schema JSON");
        serde_json::from_str(json).expect("embedded schema must be complete JSON")
    }

    fn assert_embedded_schema_matches_registry(actual: &Value, expected: &crate::pi::PiTool) {
        let object = actual
            .as_object()
            .expect("embedded schema must be a JSON object");
        assert_eq!(
            object.len(),
            3,
            "embedded schema must contain exactly name, description, and inputSchema"
        );
        assert_eq!(
            actual.get("name"),
            Some(&Value::String(expected.name.clone()))
        );
        assert_eq!(
            actual.get("description"),
            Some(&Value::String(expected.description.clone()))
        );
        assert_eq!(actual.get("inputSchema"), Some(&expected.parameters));
    }

    #[tokio::test]
    #[ignore = "requires the user's local Pi installation and Aura Pi tool selection"]
    async fn current_config_embedded_schema_and_compatibility_regression() {
        let cfg = config::effective(&config::load(), None);
        if cfg.get("piEnabled").and_then(Value::as_bool) != Some(true) {
            return;
        }
        let bridge = Arc::new(
            PiBridge::initialize(&cfg)
                .await
                .expect("Pi bridge should initialize"),
        );
        let allowed = ["grep", "find", "read", "ls"]
            .into_iter()
            .find_map(|name| bridge.allowed_tool(name))
            .or_else(|| {
                bridge
                    .tools
                    .iter()
                    .find(|tool| bridge.allowed_tool(&tool.name).is_some())
                    .cloned()
            })
            .expect("at least one Pi tool must be selected in Aura Settings");
        let blocked = bridge
            .tools
            .iter()
            .find(|tool| bridge.allowed_tool(&tool.name).is_none())
            .map(|tool| tool.name.clone());
        let server = AuraMcpServer::new(None, cfg.clone(), Some(bridge.clone()));

        let inactive_result = server
            .execute_pi_tool(Parameters(ExecutePiToolRequest {
                name: allowed.name.clone(),
                arguments: Value::Object(Default::default()),
            }))
            .await;
        assert_eq!(inactive_result.is_error, Some(true));
        assert!(
            bridge
                .active_tool_names()
                .await
                .expect("active tools after rejected execution")
                .is_empty(),
            "execute_pi_tool must not implicitly activate a tool"
        );

        let enabled = server
            .request_capabilities(Parameters(RequestCapabilitiesRequest {
                tools: vec![allowed.name.clone()],
                skills: Vec::new(),
                reason: Some("embedded schema regression".into()),
            }))
            .await;
        assert!(enabled.contains(&format!("Enabled Pi tools: {}", allowed.name)));
        let enabled_schema = embedded_schema_from_output(&enabled, "Activated", &allowed.name);
        assert_embedded_schema_matches_registry(&enabled_schema, &allowed);

        let already_active = server
            .request_capabilities(Parameters(RequestCapabilitiesRequest {
                tools: vec![allowed.name.clone()],
                skills: Vec::new(),
                reason: Some("already active schema recovery".into()),
            }))
            .await;
        assert!(already_active.contains(&format!("Already active: {}", allowed.name)));
        let active_schema = embedded_schema_from_output(&already_active, "Active", &allowed.name);
        assert_embedded_schema_matches_registry(&active_schema, &allowed);

        let unknown_name = "__aura_unknown_tool__";
        let unknown = server
            .request_capabilities(Parameters(RequestCapabilitiesRequest {
                tools: vec![unknown_name.into()],
                skills: Vec::new(),
                reason: None,
            }))
            .await;
        assert!(unknown.contains(&format!("Unknown Pi tools: {unknown_name}")));
        assert!(!unknown.contains("Pi tool schema for"));

        if let Some(blocked_name) = blocked {
            let blocked = server
                .request_capabilities(Parameters(RequestCapabilitiesRequest {
                    tools: vec![blocked_name.clone()],
                    skills: Vec::new(),
                    reason: None,
                }))
                .await;
            assert!(blocked.contains(&format!("Blocked by Aura Settings: {blocked_name}")));
            assert!(!blocked.contains("Pi tool schema for"));

            let blocked_execution = server
                .execute_pi_tool(Parameters(ExecutePiToolRequest {
                    name: blocked_name,
                    arguments: Value::Object(Default::default()),
                }))
                .await;
            assert_eq!(blocked_execution.is_error, Some(true));
        }

        if matches!(allowed.name.as_str(), "ls" | "find" | "grep" | "read") {
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let manifest = manifest_dir.join("Cargo.toml");
            let args = match allowed.name.as_str() {
                "ls" => json!({"path": manifest_dir}),
                "find" => json!({"pattern": "Cargo.toml", "path": manifest_dir}),
                "grep" => json!({"pattern": "aura", "path": manifest}),
                "read" => json!({"path": manifest, "offset": 1, "limit": 1}),
                _ => unreachable!(),
            };
            let success = server
                .execute_pi_tool(Parameters(ExecutePiToolRequest {
                    name: allowed.name.clone(),
                    arguments: args,
                }))
                .await;
            assert_ne!(success.is_error, Some(true));
        }

        if bridge.allowed_tool("read").is_some() {
            bridge
                .enable_tools(&["read".into()])
                .await
                .expect("read should activate for filesystem authority test");
            let filesystem_rejection = server
                .execute_pi_tool(Parameters(ExecutePiToolRequest {
                    name: "read".into(),
                    arguments: json!({"path": "/private/etc/passwd", "offset": 1, "limit": 1}),
                }))
                .await;
            assert_eq!(filesystem_rejection.is_error, Some(true));
        }

        if bridge.allowed_tool("bash").is_some() {
            let mut shell_cfg = cfg;
            if let Some(root) = shell_cfg.as_object_mut() {
                root.insert("shellPolicy".into(), Value::String("allowlist".into()));
                root.insert("shellAllowlist".into(), json!(["echo"]));
            }
            let shell_bridge = Arc::new(
                PiBridge::initialize(&shell_cfg)
                    .await
                    .expect("shell policy Pi bridge should initialize"),
            );
            shell_bridge
                .enable_tools(&["bash".into()])
                .await
                .expect("bash should activate for shell authority test");
            let shell_server = AuraMcpServer::new(None, shell_cfg, Some(shell_bridge.clone()));
            let shell_rejection = shell_server
                .execute_pi_tool(Parameters(ExecutePiToolRequest {
                    name: "bash".into(),
                    arguments: json!({"command": "uname -a"}),
                }))
                .await;
            assert_eq!(shell_rejection.is_error, Some(true));
            shell_bridge.shutdown().await;
        }
        bridge.shutdown().await;
    }

    #[test]
    fn legacy_admin_secret_fails_closed() {
        assert!(!verify_admin_secret(None, "anything"));
        assert!(!verify_admin_secret(
            Some("legacy-electron-safe-storage-blob"),
            "anything"
        ));
    }

    #[test]
    fn token_validity_parser_honors_supported_units_and_bounds() {
        assert_eq!(parse_token_validity_seconds("24h"), 24 * 60 * 60);
        assert_eq!(parse_token_validity_seconds("7d"), 7 * 24 * 60 * 60);
        assert_eq!(parse_token_validity_seconds("30m"), 30 * 60);
        assert_eq!(parse_token_validity_seconds("1m"), 5 * 60);
        assert_eq!(parse_token_validity_seconds("invalid"), 24 * 60 * 60);
    }

    #[tokio::test]
    async fn revoking_access_revokes_refresh_tokens_for_client() {
        let path = std::env::temp_dir().join(format!("aura-auth-test-{}.json", Uuid::new_v4()));
        let store = AuthStore::load_from(path.clone());
        let issued = store
            .issue_tokens("test-client")
            .await
            .expect("issue isolated tokens");
        let access = issued["access_token"].as_str().expect("access token");
        let refresh = issued["refresh_token"].as_str().expect("refresh token");

        assert!(store.revoke(access).await);
        let data = store.data.read().await;
        assert!(!data.tokens.contains_key(access));
        assert!(!data.tokens.contains_key(refresh));
        drop(data);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn openai_secure_tunnel_requires_loopback_listener() {
        assert!(loopback_listen_host("127.0.0.1"));
        assert!(loopback_listen_host("::1"));
        assert!(loopback_listen_host("[::1]"));
        assert!(loopback_listen_host("localhost"));
        assert!(!loopback_listen_host("0.0.0.0"));
        assert!(!loopback_listen_host("192.168.1.10"));
    }

    #[test]
    fn tunnel_readiness_patterns_cover_supported_providers() {
        assert!(tunnel_line_is_ready(
            "cloudflare-named",
            "INF Registered tunnel connection connIndex=0"
        ));
        assert!(tunnel_line_is_ready(
            "cloudflare-quick",
            "Your quick Tunnel has been created! Visit https://example.trycloudflare.com"
        ));
        assert!(tunnel_line_is_ready("openai", "tunnel connected"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn tunnel_startup_rejects_early_process_exit() {
        let mut child = Command::new("/bin/sh")
            .args(["-c", "exit 7"])
            .spawn()
            .expect("spawn test child");
        let (_tx, rx) = mpsc::unbounded_channel();
        let error = wait_for_tunnel_ready(&mut child, "openai", rx)
            .await
            .expect_err("early tunnel exit must fail startup");
        assert!(error.contains("exited before becoming ready"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn tunnel_startup_accepts_explicit_ready_signal() {
        let mut child = Command::new("/bin/sh")
            .args(["-c", "sleep 30"])
            .spawn()
            .expect("spawn test child");
        let (tx, rx) = mpsc::unbounded_channel();
        tx.send("INF Registered tunnel connection connIndex=0".into())
            .expect("send ready line");
        wait_for_tunnel_ready(&mut child, "cloudflare-named", rx)
            .await
            .expect("ready signal should complete startup");
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    #[tokio::test]
    async fn test_full_oauth_pkce_and_mcp_flow_with_allowed_hosts() {
        let temp_root = std::env::temp_dir().join(format!("aura-runtime-test-{}", Uuid::new_v4()));
        let skill_dir = temp_root.join(".agents/skills/test-skill");
        fs::create_dir_all(&skill_dir).expect("create isolated test skill directory");
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: test-skill\ndescription: Isolated Aura runtime test skill.\n---\n# Test Skill\n\nCI-safe skill content.\n",
        )
        .expect("write isolated test skill");

        let mut test_cfg = config::effective(&config::load(), None);
        let mcp_path = "/test-mcp";
        if let Some(obj) = test_cfg.as_object_mut() {
            obj.insert("listenHost".into(), Value::String("127.0.0.1".into()));
            obj.insert(
                "mcpUrl".into(),
                Value::String("https://t.xrsec.fun/test-mcp".into()),
            );
            obj.insert("mcpPath".into(), Value::String(mcp_path.into()));
            obj.insert("piEnabled".into(), Value::Bool(false));
            obj.insert("defaultCapabilitiesEnabled".into(), Value::Bool(true));
            obj.insert("defaultTools".into(), json!(["list_skills", "read_skill"]));
            obj.insert(
                "fsRoot".into(),
                Value::String(temp_root.to_string_lossy().to_string()),
            );
            obj.remove("adminSecret");
        }

        let allowed = build_allowed_hosts(&test_cfg);
        assert!(allowed.contains(&"127.0.0.1".to_string()));
        assert!(allowed.contains(&"localhost".to_string()));
        assert!(allowed.contains(&"t.xrsec.fun".to_string()));
        assert!(!allowed.contains(&"unauthorized-attacker.example.com".to_string()));

        let auth_path = temp_root.join("aura-test-auth.json");
        let auth_store = Arc::new(AuthStore::load_from(auth_path.clone()));
        let stream_config = StreamableHttpServerConfig::default()
            .with_legacy_session_mode(true)
            .with_json_response(false)
            .with_allowed_hosts(allowed);

        let server_config = test_cfg.clone();
        let mcp_service: StreamableHttpService<AuraMcpServer, LocalSessionManager> =
            StreamableHttpService::new(
                move || Ok(AuraMcpServer::new(None, server_config.clone(), None)),
                Default::default(),
                stream_config,
            );

        let web_state = Arc::new(WebState {
            auth: auth_store.clone(),
            mode: "cloudflare-named".into(),
            resource_url: "https://t.xrsec.fun/test-mcp".into(),
            admin_secret_marker: Some("test:test-password".into()),
        });
        let protected = Router::new()
            .nest_service(mcp_path, mcp_service)
            .layer(middleware::from_fn_with_state(
                None::<AppHandle>,
                crate::http_logger::log_http_request,
            ))
            .route_layer(middleware::from_fn_with_state(
                web_state.clone(),
                authorize_mcp,
            ));
        let oauth = oauth_router(web_state.clone(), mcp_path);
        let router = Router::new()
            .merge(oauth)
            .merge(protected)
            .layer(CorsLayer::permissive());

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("Failed to bind test listener");
        let local_addr = listener.local_addr().expect("Failed to get local addr");

        let cancel = CancellationToken::new();
        let server_cancel = cancel.clone();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(server_cancel.cancelled_owned())
                .await;
        });

        // 1. OAuth metadata
        let (status, _headers, body) = send_raw_http(
            local_addr,
            "GET",
            "/.well-known/oauth-authorization-server",
            "127.0.0.1",
            &[],
            "",
        )
        .await;
        assert_eq!(status, 200);
        assert!(body.contains("authorization_endpoint"));
        assert!(body.contains("t.xrsec.fun"));

        // 2. Dynamic client registration
        let reg_payload = json!({
            "client_name": "Test Client",
            "redirect_uris": [CHATGPT_CALLBACK],
            "token_endpoint_auth_method": "none"
        })
        .to_string();
        let (status, _headers, reg_body) = send_raw_http(
            local_addr,
            "POST",
            &format!("{mcp_path}/oauth/register"),
            "127.0.0.1",
            &[("Content-Type", "application/json")],
            &reg_payload,
        )
        .await;
        assert_eq!(status, 201, "registration body={reg_body}");
        let reg_json: Value = serde_json::from_str(&reg_body).expect("Valid registration JSON");
        let client_id = reg_json["client_id"].as_str().expect("client_id present");

        // 3. PKCE authorization. No admin password is configured in this isolated WebState.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let encoded_redirect = "https%3A%2F%2Fchatgpt.com%2Fconnector_platform_oauth_redirect";
        let auth_form = format!(
            "client_id={client_id}&redirect_uri={encoded_redirect}&code_challenge={challenge}&code_challenge_method=S256&response_type=code&state=xyz123&password=test-password"
        );
        let (status, headers, _body) = send_raw_http(
            local_addr,
            "POST",
            &format!("{mcp_path}/oauth/authorize"),
            "127.0.0.1",
            &[("Content-Type", "application/x-www-form-urlencoded")],
            &auth_form,
        )
        .await;
        assert_eq!(status, 303);
        let location = headers.get("location").expect("Location header present");
        let parsed_loc = Url::parse(location).expect("Valid redirect URL");
        let code = parsed_loc
            .query_pairs()
            .find(|(key, _)| key == "code")
            .expect("code param")
            .1
            .to_string();

        // 4. Token exchange
        let token_form = format!(
            "grant_type=authorization_code&client_id={client_id}&redirect_uri={encoded_redirect}&code={code}&code_verifier={verifier}"
        );
        let (status, _headers, token_body) = send_raw_http(
            local_addr,
            "POST",
            &format!("{mcp_path}/oauth/token"),
            "127.0.0.1",
            &[("Content-Type", "application/x-www-form-urlencoded")],
            &token_form,
        )
        .await;
        assert_eq!(status, 200, "token body={token_body}");
        let token_json: Value = serde_json::from_str(&token_body).expect("Valid token JSON");
        let access_token = token_json["access_token"]
            .as_str()
            .expect("access_token present");

        let init_payload = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}"#;

        // 5. Unauthenticated MCP request is rejected.
        let (status, headers, _body) = send_raw_http(
            local_addr,
            "POST",
            mcp_path,
            "127.0.0.1",
            &[
                ("Content-Type", "application/json"),
                ("Accept", "application/json, text/event-stream"),
            ],
            init_payload,
        )
        .await;
        assert_eq!(status, 401);
        assert!(headers.contains_key("www-authenticate"));

        // 6. DNS-rebinding Host protection rejects an unrelated hostname.
        let auth_value = format!("Bearer {access_token}");
        let (status, _headers, body) = send_raw_http(
            local_addr,
            "POST",
            mcp_path,
            "unauthorized-attacker.example.com",
            &[
                ("Content-Type", "application/json"),
                ("Accept", "application/json, text/event-stream"),
                ("Authorization", auth_value.as_str()),
            ],
            init_payload,
        )
        .await;
        assert_eq!(status, 403, "body={body}");
        assert!(body.contains("Host header is not allowed"));

        // 7. Active public Host is allowed and initializes MCP.
        let (status, headers, body) = send_raw_http(
            local_addr,
            "POST",
            mcp_path,
            "t.xrsec.fun",
            &[
                ("Content-Type", "application/json"),
                ("Accept", "application/json, text/event-stream"),
                ("Authorization", auth_value.as_str()),
            ],
            init_payload,
        )
        .await;
        assert_eq!(status, 200, "initialize body={body}");
        let session_id = headers.get("mcp-session-id").cloned();

        let mut mcp_headers = vec![
            ("Content-Type", "application/json"),
            ("Accept", "application/json, text/event-stream"),
            ("Authorization", auth_value.as_str()),
        ];
        if let Some(ref session_id) = session_id {
            mcp_headers.push(("mcp-session-id", session_id.as_str()));
        }

        // 8. Core tools/list is deterministic and does not require local Pi.
        let tools_payload = r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#;
        let (status, _headers, tools_body) = send_raw_http(
            local_addr,
            "POST",
            mcp_path,
            "t.xrsec.fun",
            &mcp_headers,
            tools_payload,
        )
        .await;
        assert_eq!(status, 200, "tools/list body={tools_body}");
        assert!(tools_body.contains("list_skills"));
        assert!(tools_body.contains("read_skill"));

        // 9. Skill discovery uses an isolated temporary workspace.
        let list_skills_payload = r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_skills","arguments":{}}}"#;
        let (status, _headers, skills_body) = send_raw_http(
            local_addr,
            "POST",
            mcp_path,
            "t.xrsec.fun",
            &mcp_headers,
            list_skills_payload,
        )
        .await;
        assert_eq!(status, 200, "list_skills body={skills_body}");
        assert!(skills_body.contains("test-skill"));

        let read_skill_payload = r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"read_skill","arguments":{"skill":"test-skill","path":"SKILL.md"}}}"#;
        let (status, _headers, read_skill_body) = send_raw_http(
            local_addr,
            "POST",
            mcp_path,
            "t.xrsec.fun",
            &mcp_headers,
            read_skill_payload,
        )
        .await;
        assert_eq!(status, 200, "read_skill body={read_skill_body}");
        assert!(read_skill_body.contains("CI-safe skill content"));

        cancel.cancel();
        let _ = handle.await;
        let _ = fs::remove_file(auth_path);
        let _ = fs::remove_dir_all(temp_root);
    }
}

#[derive(Default)]
pub struct RecentLogs {
    mcp: Vec<serde_json::Value>,
    tunnel: Vec<serde_json::Value>,
    runtime: Vec<serde_json::Value>,
    http: Vec<serde_json::Value>,
}

impl RecentLogs {
    fn load() -> Self {
        let path = crate::config::config_path().with_file_name("aura-logs.json");
        let value = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .unwrap_or_default();
        let tail = |key: &str, limit: usize| {
            let values = value
                .get(key)
                .and_then(serde_json::Value::as_array)
                .cloned()
                .unwrap_or_default();
            values
                .into_iter()
                .rev()
                .take(limit)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect()
        };
        Self {
            mcp: tail("mcpLogs", 500),
            tunnel: tail("tunnelLogs", 1000),
            runtime: tail("appRuntimeLogs", 1000),
            http: tail("httpLogs", 500),
        }
    }

    fn save(&self) {
        let path = crate::config::config_path().with_file_name("aura-logs.json");
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let value = serde_json::json!({
            "mcpLogs": self.mcp,
            "tunnelLogs": self.tunnel,
            "appRuntimeLogs": self.runtime,
            "httpLogs": self.http,
        });
        let _ = std::fs::write(path, serde_json::to_vec_pretty(&value).unwrap_or_default());
    }
}

fn recent_logs_store() -> &'static std::sync::Mutex<RecentLogs> {
    static STORE: std::sync::OnceLock<std::sync::Mutex<RecentLogs>> = std::sync::OnceLock::new();
    STORE.get_or_init(|| std::sync::Mutex::new(RecentLogs::load()))
}

fn with_recent_logs<T>(f: impl FnOnce(&mut RecentLogs) -> T) -> T {
    let mut logs = recent_logs_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    f(&mut logs)
}

fn push_recent_log(kind: &str, entry: &serde_json::Value) {
    with_recent_logs(|logs| {
        let (items, limit) = match kind {
            "mcp" => (&mut logs.mcp, 500),
            "http" => (&mut logs.http, 500),
            "tunnel" => (&mut logs.tunnel, 1000),
            _ => (&mut logs.runtime, 1000),
        };
        items.push(entry.clone());
        if items.len() > limit {
            items.remove(0);
        }
        logs.save();
    });
}

pub fn recent_logs() -> serde_json::Value {
    with_recent_logs(|logs| {
        serde_json::json!({
            "mcpLogs": logs.mcp.clone(),
            "httpLogs": logs.http.clone(),
            "tunnelLogs": logs.tunnel.clone(),
            "appRuntimeLogs": logs.runtime.clone()
        })
    })
}

pub fn clear_recent_logs() {
    with_recent_logs(|logs| *logs = RecentLogs::default());
}

pub fn emit_mcp_log(app: &tauri::AppHandle, entry: serde_json::Value) {
    push_recent_log("mcp", &entry);
    let _ = tauri::Emitter::emit(app, "mcp-log", entry);
}

pub fn emit_http_log(app: &tauri::AppHandle, entry: serde_json::Value) {
    push_recent_log("http", &entry);
    let _ = tauri::Emitter::emit(app, "http-log", entry.clone());
    let formatted = serde_json::json!({
        "timestamp": entry.get("timestamp").cloned().unwrap_or(serde_json::json!(crate::runtime::now_ms())),
        "mcpMethod": serde_json::Value::Null,
        "tool": serde_json::Value::Null,
        "params": serde_json::Value::Null,
        "result": if entry.get("status").and_then(|s| s.as_u64()).unwrap_or(200) >= 400 { "Error" } else { "Success" },
        "output": serde_json::Value::Null,
        "error": serde_json::Value::Null,
        "duration": entry.get("duration").cloned().unwrap_or(serde_json::json!(0)),
        "http": entry
    });
    emit_mcp_log(app, formatted);
}
