use axum::{
    body::Body,
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use serde_json::json;
use std::time::Instant;
use tauri::AppHandle;
use uuid::Uuid;

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

    let response = next.run(request).await;
    let status = response.status().as_u16();
    let duration = started.elapsed().as_millis() as u64;

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
        });
        crate::runtime::emit_http_log(&app, entry);
    }

    response
}
