use crate::{config, pi::PiBridge, skills};
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
    handler::server::{
        router::tool::{ToolRoute, ToolRouter},
        tool::ToolCallContext,
        wrapper::Parameters,
    },
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
    fs,
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

fn now_ms() -> u64 {
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
    match configured.map(str::trim).filter(|value| !value.is_empty()) {
        None => true,
        Some("keyring") => keyring_entry()
            .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
            .map(|stored| stored == input)
            .unwrap_or(false),
        // Electron safeStorage blobs cannot be decrypted by the Tauri runtime.
        // Fail closed until the user explicitly stores a new password in the OS keyring.
        Some(_) => false,
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
        let expires_in = 365_u64 * 24 * 60 * 60;
        {
            let mut data = self.data.write().await;
            data.tokens.insert(
                access_token.clone(),
                TokenRecord {
                    kind: "access".into(),
                    client_id: client_id.into(),
                    expires_at: Some(now_ms() + expires_in * 1000),
                },
            );
            data.tokens.insert(
                refresh_token.clone(),
                TokenRecord {
                    kind: "refresh".into(),
                    client_id: client_id.into(),
                    expires_at: None,
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
                    "issuedAt": expires_at.saturating_sub(365_u64 * 24 * 60 * 60 * 1000)
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
        let deleted = self.data.write().await.tokens.remove(token).is_some();
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
            let data = state.auth.data.read().await;
            data.tokens
                .get(refresh)
                .and_then(|entry| (entry.kind == "refresh").then(|| entry.client_id.clone()))
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
    skills: Vec<String>,
    #[serde(default)]
    reason: Option<String>,
}

fn default_skill_file() -> String {
    "SKILL.md".into()
}

fn resolve_safe_path(fs_root: &str, target: &str) -> Result<PathBuf, String> {
    let root = expand_home(fs_root);
    let root = fs::canonicalize(&root)
        .map_err(|error| format!("Filesystem Root is unavailable: {error}"))?;
    let raw = Path::new(target);
    let candidate = if raw.is_absolute() {
        path_clean::PathClean::clean(raw)
    } else {
        path_clean::PathClean::clean(&root.join(raw))
    };
    if !candidate.starts_with(&root) {
        return Err("Access denied: Path is outside the configured file system root.".into());
    }
    Ok(candidate)
}

#[derive(Clone)]
struct AuraMcpServer {
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
    fn new(config: Value, pi: Option<Arc<PiBridge>>) -> Self {
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
        }

        if let Some(bridge) = pi.as_ref() {
            for pi_tool in bridge.visible_tools() {
                let name = pi_tool.name.clone();
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
                let route_name = name.clone();
                let attr = Tool::new(name, description, schema);
                tool_router.add_route(ToolRoute::new_dyn(
                    attr,
                    move |context: ToolCallContext<'_, AuraMcpServer>| {
                        let route_name = route_name.clone();
                        Box::pin(async move {
                            let Some(bridge) = context.service.pi.clone() else {
                                return Ok(CallToolResult::error(vec![ContentBlock::text(
                                    "Pi bridge is unavailable.",
                                )])
                                .into());
                            };
                            let args = Value::Object(context.arguments.unwrap_or_default());
                            match bridge.execute(&route_name, args).await {
                                Ok(result) => {
                                    let is_error = result
                                        .get("isError")
                                        .and_then(Value::as_bool)
                                        .unwrap_or(false);
                                    let mut content = result
                                        .get("content")
                                        .and_then(Value::as_array)
                                        .map(|items| {
                                            items
                                                .iter()
                                                .filter_map(|item| {
                                                    serde_json::from_value::<ContentBlock>(
                                                        item.clone(),
                                                    )
                                                    .ok()
                                                })
                                                .collect::<Vec<_>>()
                                        })
                                        .unwrap_or_default();
                                    if content.is_empty() {
                                        let text = result
                                            .get("logText")
                                            .and_then(Value::as_str)
                                            .unwrap_or("(Non-text Pi result)");
                                        content.push(ContentBlock::text(text));
                                    }
                                    let result = if is_error {
                                        CallToolResult::error(content)
                                    } else {
                                        CallToolResult::success(content)
                                    };
                                    Ok(result.into())
                                }
                                Err(error) => {
                                    Ok(CallToolResult::error(vec![ContentBlock::text(error)])
                                        .into())
                                }
                            }
                        })
                    },
                ));
            }
        }

        Self {
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
}

#[tool_router(router = tool_router)]
impl AuraMcpServer {
    #[tool(description = "Read a UTF-8 file inside Aura Filesystem Root.")]
    async fn read_file(&self, Parameters(request): Parameters<ReadFileRequest>) -> String {
        match resolve_safe_path(self.fs_root(), &request.path)
            .and_then(|path| fs::read_to_string(path).map_err(|error| error.to_string()))
        {
            Ok(content) => content,
            Err(error) => format!("Error: {error}"),
        }
    }

    #[tool(description = "Create or overwrite a UTF-8 file inside Aura Filesystem Root.")]
    async fn write_file(&self, Parameters(request): Parameters<WriteFileRequest>) -> String {
        let path = match resolve_safe_path(self.fs_root(), &request.path) {
            Ok(path) => path,
            Err(error) => return format!("Error: {error}"),
        };
        if let Some(parent) = path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                return format!("Error: {error}");
            }
            if let Ok(real_parent) = fs::canonicalize(parent) {
                let Ok(real_root) = fs::canonicalize(expand_home(self.fs_root())) else {
                    return "Error: Filesystem Root is unavailable.".into();
                };
                if !real_parent.starts_with(real_root) {
                    return "Error: Access denied: resolved parent is outside Filesystem Root."
                        .into();
                }
            }
        }
        match fs::write(&path, request.content.as_bytes()) {
            Ok(()) => format!("Successfully wrote to {}", request.path),
            Err(error) => format!("Error: {error}"),
        }
    }

    #[tool(description = "Execute a shell command under Aura Shell Policy.")]
    async fn execute_shell(&self, Parameters(request): Parameters<ExecuteShellRequest>) -> String {
        let command = request.command.trim();
        let base = command.split_whitespace().next().unwrap_or_default();
        let policy = self
            .config
            .get("shellPolicy")
            .and_then(Value::as_str)
            .unwrap_or("unrestricted");
        let allowlist = self
            .config
            .get("shellAllowlist")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let denylist = self
            .config
            .get("shellDenylist")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let contains = |values: &[Value], value: &str| {
            values
                .iter()
                .filter_map(Value::as_str)
                .any(|item| item == value)
        };
        if policy == "allowlist" && !contains(&allowlist, base) {
            return format!("Error: Command '{base}' is not in the allowlist.");
        }
        if policy == "denylist" && contains(&denylist, base) {
            return format!("Error: Command '{base}' is explicitly blocked by denylist.");
        }

        #[cfg(target_os = "windows")]
        let mut process = {
            let mut process = Command::new("cmd.exe");
            process.args(["/C", command]);
            process
        };
        #[cfg(not(target_os = "windows"))]
        let mut process = {
            let mut process = Command::new("/bin/sh");
            process.args(["-lc", command]);
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
                if !output.status.success() {
                    text.push_str(&format!("\nERROR: process exited with {}", output.status));
                }
                if text.trim().is_empty() {
                    "Command executed successfully with no output.".into()
                } else {
                    text.trim().to_string()
                }
            }
            Err(error) => format!("Error: {error}"),
        }
    }

    #[tool(description = "List reusable Skills available to Aura.")]
    async fn list_skills(&self) -> String {
        if let Some(pi) = self.pi.as_ref() {
            if pi.skills.is_empty() {
                return "(No Pi Skills discovered.)".into();
            }
            return pi
                .skills
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
                .join("\n");
        }
        let discovered = skills::discover(self.fs_root());
        if discovered.is_empty() {
            return "(No local Skills discovered.)".into();
        }
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

    #[tool(description = "Read SKILL.md or another text file inside a selected Skill directory.")]
    async fn read_skill(&self, Parameters(request): Parameters<ReadSkillRequest>) -> String {
        let result = if let Some(pi) = self.pi.as_ref() {
            pi.read_skill(&request.skill, &request.path)
        } else {
            skills::read(self.fs_root(), &request.skill, &request.path)
        };
        match result {
            Ok(content) => content,
            Err(error) => format!("Error: {error}"),
        }
    }

    #[tool(description = "Load selected Pi Skills into the current context on demand.")]
    async fn request_capabilities(
        &self,
        Parameters(request): Parameters<RequestCapabilitiesRequest>,
    ) -> String {
        let Some(pi) = self.pi.as_ref() else {
            return "Error: Pi bridge is unavailable.".into();
        };
        let mut output = Vec::new();
        if let Some(reason) = request.reason.filter(|value| !value.trim().is_empty()) {
            output.push(format!("Reason: {reason}"));
        }
        for name in request.skills.into_iter().take(16) {
            match pi.read_skill(&name, "SKILL.md") {
                Ok(content) => {
                    output.push(format!("<skill name=\"{}\">\n{}\n</skill>", name, content))
                }
                Err(error) => output.push(format!("Skill {name}: {error}")),
            }
        }
        if output.is_empty() {
            "No Skills were loaded.".into()
        } else {
            output.join("\n\n")
        }
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for AuraMcpServer {
    fn get_info(&self) -> ServerInfo {
        let instructions = self
            .config
            .get("mcpInstructions")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("Aura-MCP", "1.0.1"))
            .with_instructions(instructions)
    }
}

struct RuntimeInner {
    running: bool,
    starting: bool,
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

    async fn ensure_pi(&self, cfg: &Value) -> Result<Option<Arc<PiBridge>>, String> {
        if !cfg
            .get("piEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Ok(None);
        }
        if let Some(pi) = self.inner.lock().await.pi.clone() {
            return Ok(Some(pi));
        }

        let _init_guard = self.pi_init.lock().await;
        if let Some(pi) = self.inner.lock().await.pi.clone() {
            return Ok(Some(pi));
        }

        let pi = Arc::new(PiBridge::initialize(cfg).await?);
        self.inner.lock().await.pi = Some(pi.clone());
        Ok(Some(pi))
    }

    pub async fn start(&self, app: &AppHandle) -> Result<bool, String> {
        {
            let mut inner = self.inner.lock().await;
            if inner.running {
                return Ok(true);
            }
            if inner.starting {
                return Err("Aura services are already starting.".into());
            }
            inner.starting = true;
        }

        let result = async {
            let effective = config::effective(&config::load(), None);
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

            emit_runtime(
                app,
                "info",
                &format!("Starting Aura MCP on {host}:{port}{mcp_path}"),
            );

            let pi = match self.ensure_pi(&effective).await {
                Ok(pi) => {
                    if let Some(bridge) = pi.as_ref() {
                        emit_runtime(
                            app,
                            "info",
                            &format!(
                                "Pi bridge ready: {} tools, {} skills (Pi {}, Node {}).",
                                bridge.visible_tools().len(),
                                bridge.skills.len(),
                                bridge.version,
                                bridge.node_version
                            ),
                        );
                    }
                    pi
                }
                Err(error) => {
                    return Err(format!("Pi bridge initialization failed: {error}"));
                }
            };

            let allowed_hosts = build_allowed_hosts(&effective);
            let stream_config = StreamableHttpServerConfig::default()
                .with_legacy_session_mode(true)
                .with_json_response(false)
                .with_allowed_hosts(allowed_hosts);
            let server_config = effective.clone();
            let server_pi = pi.clone();
            let mcp_service: StreamableHttpService<AuraMcpServer, LocalSessionManager> =
                StreamableHttpService::new(
                    move || Ok(AuraMcpServer::new(server_config.clone(), server_pi.clone())),
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
            let protected = Router::new()
                .nest_service(&mcp_path, mcp_service)
                .route_layer(middleware::from_fn_with_state(
                    web_state.clone(),
                    authorize_mcp,
                ));
            let oauth = oauth_router(web_state.clone(), &mcp_path);
            let router = Router::new()
                .merge(oauth)
                .merge(protected)
                .layer(CorsLayer::permissive());

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

            let tunnel = match start_tunnel(app, &effective).await {
                Ok(child) => child,
                Err(error) => {
                    cancel.cancel();
                    let _ = task.await;
                    return Err(format!("Failed to start tunnel: {error}"));
                }
            };

            Ok::<_, String>((cancel, task, tunnel, pi))
        }
        .await;

        match result {
            Ok((cancel, task, tunnel, pi)) => {
                let mut inner = self.inner.lock().await;
                inner.server_cancel = Some(cancel);
                inner.server_task = Some(task);
                inner.tunnel = tunnel;
                inner.pi = pi;
                inner.running = true;
                inner.starting = false;
                drop(inner);
                let _ = app.emit("service-state-changed", true);
                emit_runtime(app, "info", "Aura MCP services are running.");
                Ok(true)
            }
            Err(error) => {
                let mut inner = self.inner.lock().await;
                inner.starting = false;
                inner.running = false;
                let pi = inner.pi.take();
                drop(inner);
                if let Some(pi) = pi {
                    pi.shutdown().await;
                }
                let _ = app.emit("service-state-changed", false);
                emit_runtime(app, "error", &format!("Aura startup failed: {error}"));
                Err(error)
            }
        }
    }

    pub async fn stop(&self, app: &AppHandle) -> Result<bool, String> {
        let (cancel, task, mut tunnel, pi) = {
            let mut inner = self.inner.lock().await;
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
        match self.ensure_pi(&cfg).await {
            Ok(Some(pi)) => pi_capabilities_value(&pi),
            Ok(None) => json!({
                "available": false,
                "version": null,
                "tools": [],
                "error": "Pi capabilities are disabled in Aura Settings."
            }),
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

fn emit_runtime(app: &AppHandle, level: &str, message: &str) {
    let _ = app.emit(
        "runtime-log",
        json!({
            "timestamp": now_ms(),
            "level": level,
            "source": "App",
            "message": message,
            "detail": null
        }),
    );
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

fn locate_binary(mode: &str, configured: &str) -> Option<PathBuf> {
    if !configured.trim().is_empty() {
        let path = expand_home(configured);
        if is_executable(&path) {
            return Some(path);
        }
    }
    let name = executable_name(mode);
    let mut candidates = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
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
    let binary = locate_binary(mode, configured).ok_or_else(|| {
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

    command.stdout(Stdio::piped()).stderr(Stdio::piped());
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

    #[test]
    fn legacy_admin_secret_fails_closed() {
        assert!(verify_admin_secret(None, "anything"));
        assert!(!verify_admin_secret(
            Some("legacy-electron-safe-storage-blob"),
            "anything"
        ));
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
                move || Ok(AuraMcpServer::new(server_config.clone(), None)),
                Default::default(),
                stream_config,
            );

        let web_state = Arc::new(WebState {
            auth: auth_store.clone(),
            mode: "cloudflare-named".into(),
            resource_url: "https://t.xrsec.fun/test-mcp".into(),
            admin_secret_marker: None,
        });
        let protected = Router::new()
            .nest_service(mcp_path, mcp_service)
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
