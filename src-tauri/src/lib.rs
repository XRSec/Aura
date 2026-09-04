mod config;
mod http_logger;
mod pi;
mod runtime;
mod skills;

use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
};
use tauri::Manager;

#[derive(Serialize)]
struct ListenAddress {
    name: String,
    address: String,
    family: &'static str,
    internal: bool,
}

#[derive(Serialize)]
struct BinaryPathOption {
    path: String,
    detected: bool,
}

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_home_path(input: &str) -> PathBuf {
    if input == "~" {
        return home_dir();
    }
    if let Some(rest) = input.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    PathBuf::from(input)
}

#[cfg(target_os = "macos")]
fn interface_display_names() -> HashMap<String, String> {
    let output = match std::process::Command::new("/usr/sbin/networksetup")
        .arg("-listallhardwareports")
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return HashMap::new(),
    };

    let mut names = HashMap::new();
    let mut hardware_port = None;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if let Some(value) = line.strip_prefix("Hardware Port: ") {
            hardware_port = Some(value.trim().to_string());
        } else if let Some(device) = line.strip_prefix("Device: ") {
            if let Some(port) = hardware_port.take() {
                names.insert(device.trim().to_string(), port);
            }
        }
    }
    names
}

#[cfg(not(target_os = "macos"))]
fn interface_display_names() -> HashMap<String, String> {
    HashMap::new()
}

fn valid_hostname(hostname: &str) -> bool {
    if hostname.len() > 253 || !hostname.contains('.') {
        return false;
    }
    hostname.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    })
}

fn inspect_cloudflare_config(custom_path: &str) -> Value {
    let path = if custom_path.trim().is_empty() {
        home_dir().join(".cloudflared").join("config.yml")
    } else {
        resolve_home_path(custom_path.trim())
    };
    let display_path = path.to_string_lossy().to_string();
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) => {
            let missing = matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied
            );
            return json!({
                "path": display_path,
                "exists": !missing,
                "hostnames": [],
                "error": if custom_path.trim().is_empty() && missing { Value::Null } else { Value::String("The selected Cloudflare config cannot be read.".into()) }
            });
        }
    };
    if !metadata.is_file() {
        return json!({"path": display_path, "exists": true, "hostnames": [], "error": "Cloudflare config is not a file."});
    }
    if metadata.len() > 1024 * 1024 {
        return json!({"path": display_path, "exists": true, "hostnames": [], "error": "Cloudflare config is larger than 1 MiB."});
    }
    let source = match fs::read_to_string(&path) {
        Ok(source) => source,
        Err(_) => {
            return json!({"path": display_path, "exists": true, "hostnames": [], "error": "The selected Cloudflare config cannot be read."})
        }
    };
    let yaml: serde_yaml::Value = match serde_yaml::from_str(&source) {
        Ok(value) => value,
        Err(error) => {
            return json!({"path": display_path, "exists": true, "hostnames": [], "error": error.to_string()})
        }
    };
    let value = match serde_json::to_value(yaml) {
        Ok(value) => value,
        Err(error) => {
            return json!({"path": display_path, "exists": true, "hostnames": [], "error": error.to_string()})
        }
    };
    if value
        .get("tunnel")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .is_none()
    {
        return json!({"path": display_path, "exists": true, "hostnames": [], "error": "Cloudflare config has no tunnel id or name."});
    }
    let Some(ingress) = value.get("ingress").and_then(Value::as_array) else {
        return json!({"path": display_path, "exists": true, "hostnames": [], "error": "Cloudflare config has no valid ingress rules."});
    };
    let mut seen = HashSet::new();
    let mut hostnames = Vec::new();
    for rule in ingress {
        if rule.get("path").is_some() {
            continue;
        }
        let Some(hostname) = rule.get("hostname").and_then(Value::as_str) else {
            continue;
        };
        let hostname = hostname.trim().to_ascii_lowercase();
        if valid_hostname(&hostname) && seen.insert(hostname.clone()) {
            hostnames.push(hostname);
        }
    }
    let error = if hostnames.is_empty() {
        Some("Cloudflare config has no exact hostname ingress rule without a path.")
    } else {
        None
    };
    json!({"path": display_path, "exists": true, "hostnames": hostnames, "error": error})
}

fn discover_cloudflare_configs_impl() -> Vec<String> {
    let dot_folder = home_dir().join(".cloudflared");
    let mut candidates = vec![
        dot_folder.join("config.yml"),
        dot_folder.join("config.yaml"),
    ];
    #[cfg(target_os = "windows")]
    {
        candidates.push(PathBuf::from(r"C:\ProgramData\cloudflared\config.yml"));
        candidates.push(PathBuf::from(r"C:\ProgramData\cloudflared\config.yaml"));
    }
    #[cfg(not(target_os = "windows"))]
    {
        candidates.push(PathBuf::from("/etc/cloudflared/config.yml"));
        candidates.push(PathBuf::from("/etc/cloudflared/config.yaml"));
    }
    if let Ok(entries) = fs::read_dir(&dot_folder) {
        for entry in entries.flatten() {
            let path = entry.path();
            if matches!(
                path.extension().and_then(|ext| ext.to_str()),
                Some("yml" | "yaml")
            ) && !candidates.contains(&path)
            {
                candidates.push(path);
            }
        }
    }
    candidates
        .into_iter()
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

fn is_executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path)
            .map(|meta| meta.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn tunnel_binary_name(mode: &str) -> &'static str {
    if mode == "openai" {
        #[cfg(target_os = "windows")]
        return "tunnel-client.exe";
        #[cfg(not(target_os = "windows"))]
        return "tunnel-client";
    }
    #[cfg(target_os = "windows")]
    return "cloudflared.exe";
    #[cfg(not(target_os = "windows"))]
    return "cloudflared";
}

fn common_binary_dirs() -> Vec<PathBuf> {
    let home = home_dir();
    let mut dirs = vec![
        home.join(".local/bin"),
        home.join("bin"),
        home.join("go/bin"),
        home.join(".cargo/bin"),
    ];
    #[cfg(target_os = "macos")]
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ]);
    #[cfg(target_os = "linux")]
    dirs.extend([
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/snap/bin"),
    ]);
    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let base = PathBuf::from(local_app_data);
            dirs.push(base.join("Programs/tunnel-client"));
            dirs.push(base.join("cloudflared"));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            let base = PathBuf::from(program_files);
            dirs.push(base.join("tunnel-client"));
            dirs.push(base.join("cloudflared"));
        }
        if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
            dirs.push(PathBuf::from(program_files_x86).join("cloudflared"));
        }
    }
    dirs
}

fn default_binary_paths(mode: &str) -> Vec<PathBuf> {
    let home = home_dir();
    let name = tunnel_binary_name(mode);
    #[cfg(target_os = "macos")]
    {
        if mode == "openai" {
            return vec![
                home.join(".local/bin").join(name),
                home.join("bin").join(name),
                home.join("go/bin").join(name),
                PathBuf::from("/opt/homebrew/bin/tunnel-client"),
                PathBuf::from("/usr/local/bin/tunnel-client"),
            ];
        }
        return vec![
            PathBuf::from("/opt/homebrew/bin/cloudflared"),
            PathBuf::from("/usr/local/bin/cloudflared"),
            PathBuf::from("/usr/bin/cloudflared"),
        ];
    }
    #[cfg(target_os = "linux")]
    {
        if mode == "openai" {
            return vec![
                home.join(".local/bin").join(name),
                home.join("bin").join(name),
                home.join("go/bin").join(name),
                PathBuf::from("/usr/local/bin/tunnel-client"),
                PathBuf::from("/usr/bin/tunnel-client"),
            ];
        }
        return vec![
            PathBuf::from("/usr/local/bin/cloudflared"),
            PathBuf::from("/usr/bin/cloudflared"),
            PathBuf::from("/home/linuxbrew/.linuxbrew/bin/cloudflared"),
            PathBuf::from("/snap/bin/cloudflared"),
        ];
    }
    #[cfg(target_os = "windows")]
    {
        let local = env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Local"));
        let program_files = env::var_os("ProgramFiles")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
        if mode == "openai" {
            return vec![
                local.join("Programs/tunnel-client").join(name),
                program_files.join("tunnel-client").join(name),
                home.join(".local/bin").join(name),
                home.join("bin").join(name),
                home.join("go/bin").join(name),
            ];
        }
        let program_files_x86 = env::var_os("ProgramFiles(x86)")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Program Files (x86)"));
        return vec![
            program_files_x86.join("cloudflared").join(name),
            program_files.join("cloudflared").join(name),
            local.join("cloudflared").join(name),
            home.join("bin").join(name),
        ];
    }
}

fn discover_tunnel_binaries_impl(mode: &str) -> Vec<BinaryPathOption> {
    let name = tunnel_binary_name(mode);
    let mut search_dirs: Vec<PathBuf> =
        env::split_paths(&env::var_os("PATH").unwrap_or_default()).collect();
    let common_dirs = common_binary_dirs();
    search_dirs.extend(common_dirs.iter().cloned());

    let mut seen = HashSet::new();
    let mut options = Vec::new();
    for dir in search_dirs {
        let candidate = dir.join(name);
        if is_executable_file(&candidate) {
            let path = candidate.to_string_lossy().to_string();
            if seen.insert(path.clone()) {
                options.push(BinaryPathOption {
                    path,
                    detected: true,
                });
            }
        }
    }
    for candidate in default_binary_paths(mode) {
        let path = candidate.to_string_lossy().to_string();
        if seen.insert(path.clone()) {
            options.push(BinaryPathOption {
                detected: is_executable_file(&candidate),
                path,
            });
        }
    }
    options
}

fn config_for_frontend(config: &Value, mode: Option<&str>) -> Value {
    let marker = config
        .get("adminSecret")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut result = config::effective(config, mode);
    if let Some(root) = result.as_object_mut() {
        root.remove("adminSecret");
        root.insert(
            "adminSecretConfigured".into(),
            Value::Bool(marker == Some("keyring")),
        );
        root.insert(
            "adminSecretNeedsReset".into(),
            Value::Bool(marker.is_some() && marker != Some("keyring")),
        );
    }
    result
}

#[tauri::command]
fn get_config(mode: Option<String>) -> Value {
    let config = config::load();
    config_for_frontend(&config, mode.as_deref())
}

#[tauri::command]
fn save_config(cfg: Value) -> Result<Value, String> {
    let updated = config::update(config::load(), &cfg);
    config::write(&updated).map_err(|error| error.to_string())?;
    Ok(config_for_frontend(
        &updated,
        cfg.get("tunnelMode").and_then(Value::as_str),
    ))
}

#[tauri::command]
fn save_provider_config(mode: String, updates: Value) -> Result<bool, String> {
    let updated = config::update_provider(config::load(), &mode, &updates);
    config::write(&updated).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
async fn get_pi_capabilities(
    runtime: tauri::State<'_, runtime::RuntimeManager>,
) -> Result<Value, String> {
    Ok(runtime.pi_capabilities().await)
}

#[tauri::command]
fn get_cf_hostnames(custom_path: String) -> Value {
    inspect_cloudflare_config(&custom_path)
}

#[tauri::command]
fn discover_cf_configs() -> Vec<String> {
    discover_cloudflare_configs_impl()
}

#[tauri::command]
fn get_listen_addresses() -> Vec<ListenAddress> {
    let mut addresses = vec![
        ListenAddress {
            name: "Loopback only".into(),
            address: "127.0.0.1".into(),
            family: "IPv4",
            internal: true,
        },
        ListenAddress {
            name: "All network interfaces".into(),
            address: "0.0.0.0".into(),
            family: "IPv4",
            internal: false,
        },
    ];
    let mut seen = HashSet::from(["127.0.0.1".to_string(), "0.0.0.0".to_string()]);

    if let Ok(interfaces) = if_addrs::get_if_addrs() {
        let display_names = interface_display_names();
        let mut detected = interfaces
            .into_iter()
            .filter_map(|interface| match interface.addr {
                if_addrs::IfAddr::V4(ipv4) if !ipv4.ip.is_loopback() => {
                    let address = ipv4.ip.to_string();
                    if seen.insert(address.clone()) {
                        let name = display_names
                            .get(&interface.name)
                            .map(|friendly| format!("{friendly} ({})", interface.name))
                            .unwrap_or(interface.name);
                        Some(ListenAddress {
                            name,
                            address,
                            family: "IPv4",
                            internal: false,
                        })
                    } else {
                        None
                    }
                }
                _ => None,
            })
            .collect::<Vec<_>>();

        detected.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.address.cmp(&b.address)));
        addresses.extend(detected);
    }

    addresses
}

#[tauri::command]
async fn get_service_state(
    runtime: tauri::State<'_, runtime::RuntimeManager>,
) -> Result<bool, String> {
    Ok(runtime.is_running().await)
}

#[tauri::command]
async fn toggle_service_state(
    connect: bool,
    runtime: tauri::State<'_, runtime::RuntimeManager>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    if connect {
        runtime.start(&app).await
    } else {
        runtime.stop(&app).await
    }
}

#[tauri::command]
async fn restart_tunnel(
    mode: Option<String>,
    runtime: tauri::State<'_, runtime::RuntimeManager>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    if let Some(mode) = mode {
        let updated = config::update(config::load(), &json!({"tunnelMode": mode}));
        config::write(&updated).map_err(|error| error.to_string())?;
    }
    runtime.restart(&app).await
}

#[tauri::command]
async fn get_tokens(
    runtime: tauri::State<'_, runtime::RuntimeManager>,
) -> Result<Vec<Value>, String> {
    Ok(runtime.auth.active_tokens().await)
}

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn log_runtime(app: tauri::AppHandle, level: String, message: String) {
    runtime::emit_runtime(&app, &level, &message);
}

fn logs_path() -> PathBuf {
    config::config_path().with_file_name("aura-logs.json")
}

#[tauri::command]
fn get_recent_logs() -> Value {
    runtime::recent_logs()
}

#[tauri::command]
fn clear_recent_logs() -> Result<Value, String> {
    runtime::clear_recent_logs();
    let empty = json!({"mcpLogs": [], "tunnelLogs": [], "appRuntimeLogs": [], "httpLogs": []});
    if let Some(parent) = logs_path().parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(
        logs_path(),
        serde_json::to_vec_pretty(&empty).map_err(|error| error.to_string())?,
    );
    Ok(json!({"ok": true}))
}

#[tauri::command]
async fn revoke_token(
    token: String,
    runtime: tauri::State<'_, runtime::RuntimeManager>,
) -> Result<bool, String> {
    Ok(runtime.auth.revoke(&token).await)
}

#[tauri::command]
fn save_secret(secret: String) -> Result<bool, String> {
    runtime::save_admin_secret(&secret)?;
    Ok(true)
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http:// and https:// URLs can be opened externally.".into());
    }
    open::that(url).map_err(|error| error.to_string())
}

#[tauri::command]
fn pick_cf_config() -> Option<Value> {
    let path = rfd::FileDialog::new()
        .set_title("Select Cloudflare Config File")
        .add_filter("YAML Config", &["yml", "yaml", "json"])
        .pick_file()?;
    Some(inspect_cloudflare_config(path.to_string_lossy().as_ref()))
}

#[tauri::command]
fn discover_tunnel_binaries(mode: String) -> Vec<BinaryPathOption> {
    discover_tunnel_binaries_impl(&mode)
}

#[tauri::command]
fn discover_acme_certs() -> Vec<Value> {
    Vec::new()
}

#[tauri::command]
fn pick_cert_file() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Select SSL Certificate File")
        .add_filter("Certificates", &["cer", "crt", "pem"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_key_file() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Select SSL Private Key File")
        .add_filter("Private Keys", &["key", "pem"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn validate_ssl_files(cert_path: String, key_path: String) -> Value {
    let cert_path = resolve_home_path(&cert_path);
    let key_path = resolve_home_path(&key_path);
    let cert = match fs::read_to_string(&cert_path) {
        Ok(value) => value,
        Err(_) => return json!({"valid": false, "error": "SSL Certificate file does not exist"}),
    };
    let key = match fs::read_to_string(&key_path) {
        Ok(value) => value,
        Err(_) => return json!({"valid": false, "error": "SSL Private Key file does not exist"}),
    };
    if !cert.contains("CERTIFICATE") {
        return json!({"valid": false, "error": "SSL Certificate file is missing standard header (CERTIFICATE)"});
    }
    if !(key.contains("PRIVATE KEY") || key.contains("KEY")) {
        return json!({"valid": false, "error": "SSL Private Key file is missing standard header (PRIVATE KEY)"});
    }
    json!({"valid": true})
}

struct QuitState(std::sync::atomic::AtomicBool);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(runtime::RuntimeManager::new())
        .setup(|app| {
            app.manage(QuitState(std::sync::atomic::AtomicBool::new(false)));

            // 1. Setup Application Menu (Top Bar)
            let reload_i =
                tauri::menu::MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?;

            #[cfg(target_os = "macos")]
            let app_menu = {
                let aura = tauri::menu::Submenu::with_items(
                    app,
                    "Aura",
                    true,
                    &[
                        &tauri::menu::PredefinedMenuItem::about(app, None, None)?,
                        &tauri::menu::PredefinedMenuItem::separator(app)?,
                        &tauri::menu::PredefinedMenuItem::close_window(app, Some("Close Aura"))?,
                        &tauri::menu::PredefinedMenuItem::separator(app)?,
                        &tauri::menu::PredefinedMenuItem::services(app, None)?,
                        &tauri::menu::PredefinedMenuItem::separator(app)?,
                        &tauri::menu::PredefinedMenuItem::quit(app, None)?,
                    ],
                )?;
                let view = tauri::menu::Submenu::with_items(
                    app,
                    "View",
                    true,
                    &[
                        &reload_i,
                        &tauri::menu::PredefinedMenuItem::separator(app)?,
                        &tauri::menu::PredefinedMenuItem::fullscreen(app, None)?,
                        &tauri::menu::PredefinedMenuItem::separator(app)?,
                        &tauri::menu::PredefinedMenuItem::minimize(app, None)?,
                        &tauri::menu::PredefinedMenuItem::separator(app)?,
                        &tauri::menu::PredefinedMenuItem::hide(app, None)?,
                        &tauri::menu::PredefinedMenuItem::hide_others(app, None)?,
                        &tauri::menu::PredefinedMenuItem::show_all(app, None)?,
                    ],
                )?;
                let edit = tauri::menu::Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &tauri::menu::PredefinedMenuItem::undo(app, None)?,
                        &tauri::menu::PredefinedMenuItem::redo(app, None)?,
                        &tauri::menu::PredefinedMenuItem::separator(app)?,
                        &tauri::menu::PredefinedMenuItem::cut(app, None)?,
                        &tauri::menu::PredefinedMenuItem::copy(app, None)?,
                        &tauri::menu::PredefinedMenuItem::paste(app, None)?,
                        &tauri::menu::PredefinedMenuItem::select_all(app, None)?,
                    ],
                )?;
                tauri::menu::Menu::with_items(app, &[&aura, &edit, &view])?
            };

            #[cfg(not(target_os = "macos"))]
            let app_menu = {
                let view = tauri::menu::Submenu::with_items(app, "View", true, &[&reload_i])?;
                tauri::menu::Menu::with_items(app, &[&view])?
            };

            let _ = app.set_menu(app_menu);

            // 2. Setup Tray Icon Menu
            let tray_quit_i =
                tauri::menu::MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
            let tray_show_i =
                tauri::menu::MenuItem::with_id(app, "tray_show", "Show Aura", true, None::<&str>)?;
            let tray_menu = tauri::menu::Menu::with_items(app, &[&tray_show_i, &tray_quit_i])?;

            let mut tray = tauri::tray::TrayIconBuilder::new()
                .menu(&tray_menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "tray_quit" => {
                        app.state::<QuitState>()
                            .0
                            .store(true, std::sync::atomic::Ordering::SeqCst);
                        app.exit(0);
                    }
                    "tray_show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            #[cfg(target_os = "macos")]
                            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            #[cfg(target_os = "macos")]
                            let _ = tray
                                .app_handle()
                                .set_activation_policy(tauri::ActivationPolicy::Regular);
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // 3. Auto connect tunnel
            if config::load()
                .get("autoConnect")
                .and_then(Value::as_bool)
                .unwrap_or(true)
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let runtime = handle.state::<runtime::RuntimeManager>();
                    if let Err(error) = runtime.start(&handle).await {
                        eprintln!("Aura auto-connect failed: {error}");
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<QuitState>();
                if !state.0.load(std::sync::atomic::Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                    #[cfg(target_os = "macos")]
                    let _ = window
                        .app_handle()
                        .set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
            }
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "reload" {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval("window.location.reload();");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            save_provider_config,
            get_pi_capabilities,
            get_cf_hostnames,
            discover_cf_configs,
            get_listen_addresses,
            get_service_state,
            toggle_service_state,
            restart_tunnel,
            get_tokens,
            get_app_version,
            log_runtime,
            get_recent_logs,
            clear_recent_logs,
            revoke_token,
            save_secret,
            open_external,
            pick_cf_config,
            discover_tunnel_binaries,
            discover_acme_certs,
            pick_cert_file,
            pick_key_file,
            validate_ssl_files
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            let state = app_handle.state::<QuitState>();
            state.0.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_listen_addresses_enumeration() {
        let addresses = get_listen_addresses();
        println!("Enumerated listen addresses ({}):", addresses.len());
        for addr in &addresses {
            println!(
                "  - {} · {} ({}) internal={}",
                addr.address, addr.name, addr.family, addr.internal
            );
        }
        assert!(addresses.iter().any(|a| a.address == "127.0.0.1"));
        assert!(addresses.iter().any(|a| a.address == "0.0.0.0"));
    }
}
