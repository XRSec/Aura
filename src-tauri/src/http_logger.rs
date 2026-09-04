use axum::{
    body::Body,
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use serde_json::{json, Map, Value};
use std::time::Instant;
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Clone)]
struct HttpRequestContext {
    method: String,
    url: String,
    ip: String,
    auth: String,
    request_id: String,
    user_agent: String,
    query: Option<String>,
    headers: Option<Value>,
}

tokio::task_local! {
    static HTTP_REQUEST_CONTEXT: HttpRequestContext;
}

fn sensitive_header(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    matches!(
        name.as_str(),
        "authorization"
            | "proxy-authorization"
            | "cookie"
            | "set-cookie"
            | "x-api-key"
            | "api-key"
            | "x-auth-token"
            | "cf-access-jwt-assertion"
    ) || name.contains("token")
        || name.contains("secret")
}

fn headers_for_log(headers: &axum::http::HeaderMap) -> Value {
    let mut output = Map::new();
    for name in headers.keys() {
        let values = headers
            .get_all(name)
            .iter()
            .map(|value| {
                if sensitive_header(name.as_str()) {
                    Value::String("[REDACTED]".into())
                } else {
                    Value::String(
                        value
                            .to_str()
                            .map(ToOwned::to_owned)
                            .unwrap_or_else(|_| "[NON-UTF8]".into()),
                    )
                }
            })
            .collect::<Vec<_>>();
        let value = if values.len() == 1 {
            values.into_iter().next().unwrap_or(Value::Null)
        } else {
            Value::Array(values)
        };
        output.insert(name.as_str().to_string(), value);
    }
    Value::Object(output)
}

pub fn current_http_context() -> Option<Value> {
    HTTP_REQUEST_CONTEXT
        .try_with(|context| {
            json!({
                "method": context.method,
                "url": context.url,
                "ip": context.ip,
                "auth": context.auth,
                "requestId": context.request_id,
                "userAgent": context.user_agent,
                "query": context.query,
                "headers": context.headers,
            })
        })
        .ok()
}

pub async fn log_http_request(
    State(app): State<Option<AppHandle>>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let started = Instant::now();
    let method = request.method().as_str().to_string();
    let path = request.uri().path().to_string();
    let url = request
        .uri()
        .path_and_query()
        .map(|value| value.as_str().to_string())
        .unwrap_or_else(|| path.clone());

    let ip = request
        .headers()
        .get("cf-connecting-ip")
        .or_else(|| request.headers().get("x-forwarded-for"))
        .and_then(|value| value.to_str().ok())
        .unwrap_or("127.0.0.1")
        .to_string();

    let auth = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            if let Some(token) = value.strip_prefix("Bearer ") {
                let prefix: String = token.chars().take(8).collect();
                format!("Bearer {prefix}...")
            } else {
                "Present".to_string()
            }
        })
        .unwrap_or_else(|| "None".to_string());

    let request_id = Uuid::new_v4().to_string();
    let user_agent = request
        .headers()
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let query = request.uri().query().map(ToOwned::to_owned);
    let debug_mode = crate::config::load()
        .get("debugMode")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let headers = debug_mode.then(|| headers_for_log(request.headers()));
    let context = HttpRequestContext {
        method: method.clone(),
        url: url.clone(),
        ip: ip.clone(),
        auth: auth.clone(),
        request_id: request_id.clone(),
        user_agent: user_agent.clone(),
        query: query.clone(),
        headers: headers.clone(),
    };

    let response = HTTP_REQUEST_CONTEXT.scope(context, next.run(request)).await;
    let status = response.status().as_u16();
    let duration = started.elapsed().as_millis() as u64;
    let response_headers = debug_mode.then(|| headers_for_log(response.headers()));

    if let Some(app) = app {
        let entry = json!({
            "timestamp": crate::runtime::now_ms(),
            "method": method,
            "url": url,
            "ip": ip,
            "auth": auth,
            "requestId": request_id,
            "status": status,
            "duration": duration,
            "userAgent": user_agent,
            "query": query,
            "headers": headers,
            "responseHeaders": response_headers,
        });
        crate::runtime::emit_http_log(&app, entry);
    }

    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn debug_headers_keep_structure_and_redact_secrets() {
        let mut headers = HeaderMap::new();
        headers.insert("content-type", HeaderValue::from_static("application/json"));
        headers.insert(
            "authorization",
            HeaderValue::from_static("Bearer secret-token"),
        );
        headers.insert("x-api-key", HeaderValue::from_static("top-secret"));
        let logged = headers_for_log(&headers);
        assert_eq!(logged["content-type"], "application/json");
        assert_eq!(logged["authorization"], "[REDACTED]");
        assert_eq!(logged["x-api-key"], "[REDACTED]");
    }

    #[tokio::test]
    async fn request_context_is_available_inside_scope() {
        let context = HttpRequestContext {
            method: "POST".into(),
            url: "/mcp".into(),
            ip: "127.0.0.1".into(),
            auth: "Bearer abcdefgh...".into(),
            request_id: "req-1".into(),
            user_agent: "test-agent".into(),
            query: None,
            headers: Some(json!({"content-type":"application/json"})),
        };
        HTTP_REQUEST_CONTEXT
            .scope(context, async {
                let value = current_http_context().expect("request context");
                assert_eq!(value["method"], "POST");
                assert_eq!(value["headers"]["content-type"], "application/json");
            })
            .await;
    }
}
