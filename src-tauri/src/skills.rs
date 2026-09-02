use serde::Serialize;
use serde_yaml::Value as YamlValue;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

const MAX_SKILL_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub dir: PathBuf,
    pub source: String,
}

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn expand_home(value: &str) -> PathBuf {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "~" {
        return home_dir();
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    PathBuf::from(trimmed)
}

fn direct_package_roots(node_modules: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let Ok(entries) = fs::read_dir(node_modules) else {
        return roots;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if name.starts_with('@') {
            if let Ok(scoped) = fs::read_dir(entry.path()) {
                for package in scoped.flatten() {
                    if package
                        .file_type()
                        .map(|kind| kind.is_dir())
                        .unwrap_or(false)
                    {
                        roots.push(package.path());
                    }
                }
            }
        } else {
            roots.push(entry.path());
        }
    }
    roots
}

fn parse_frontmatter(content: &str, fallback: &str) -> (String, String) {
    let normalized = content.replace("\r\n", "\n");
    let Some(rest) = normalized.strip_prefix("---\n") else {
        return (fallback.to_string(), String::new());
    };
    let Some(end) = rest.find("\n---") else {
        return (fallback.to_string(), String::new());
    };
    let metadata: YamlValue = serde_yaml::from_str(&rest[..end]).unwrap_or(YamlValue::Null);
    let name = metadata
        .get("name")
        .and_then(YamlValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string();
    let description = metadata
        .get("description")
        .and_then(YamlValue::as_str)
        .unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (name, description)
}

fn candidate_roots(fs_root: &str) -> Vec<(PathBuf, String)> {
    let home = home_dir();
    let mut roots = vec![
        (
            expand_home(fs_root).join(".agents/skills"),
            "workspace".to_string(),
        ),
        (home.join(".agents/skills"), "user".to_string()),
        (home.join(".pi/agent/skills"), "pi".to_string()),
    ];

    let extensions = home.join(".pi/agent/extensions");
    if let Ok(entries) = fs::read_dir(extensions) {
        for entry in entries.flatten() {
            if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                let name = entry.file_name().to_string_lossy().to_string();
                roots.push((entry.path().join("skills"), format!("pi-extension:{name}")));
            }
        }
    }

    for package in direct_package_roots(&home.join(".pi/agent/npm/node_modules")) {
        let name = package
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "package".into());
        roots.push((package.join("skills"), format!("pi-package:{name}")));
    }

    roots
}

pub fn discover(fs_root: &str) -> Vec<SkillInfo> {
    let mut skills = HashMap::<String, SkillInfo>::new();
    let mut seen_roots = HashSet::new();

    for (root, source) in candidate_roots(fs_root) {
        let Ok(real_root) = fs::canonicalize(root) else {
            continue;
        };
        if !seen_roots.insert(real_root.clone()) {
            continue;
        }
        let Ok(entries) = fs::read_dir(&real_root) else {
            continue;
        };
        for entry in entries.flatten() {
            if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            let skill_dir = entry.path();
            let skill_file = skill_dir.join("SKILL.md");
            let (Ok(real_dir), Ok(real_file)) =
                (fs::canonicalize(&skill_dir), fs::canonicalize(&skill_file))
            else {
                continue;
            };
            if !real_dir.starts_with(&real_root) || !real_file.starts_with(&real_dir) {
                continue;
            }
            let Ok(content) = fs::read_to_string(&real_file) else {
                continue;
            };
            let fallback = entry.file_name().to_string_lossy().to_string();
            let (name, description) = parse_frontmatter(&content, &fallback);
            if name.is_empty() || skills.contains_key(&name) {
                continue;
            }
            skills.insert(
                name.clone(),
                SkillInfo {
                    name,
                    description,
                    dir: real_dir,
                    source: source.clone(),
                },
            );
        }
    }

    let mut result = skills.into_values().collect::<Vec<_>>();
    result.sort_by(|a, b| a.name.cmp(&b.name));
    result
}

pub fn read(fs_root: &str, skill_name: &str, relative_path: &str) -> Result<String, String> {
    let skills = discover(fs_root);
    let skill = skills
        .into_iter()
        .find(|skill| skill.name == skill_name.trim())
        .ok_or_else(|| format!("Unknown skill '{}'. Call list_skills first.", skill_name))?;

    let requested = if relative_path.trim().is_empty() {
        "SKILL.md"
    } else {
        relative_path.trim()
    };
    let requested_path = Path::new(requested);
    if requested_path.is_absolute() {
        return Err("Skill file path must be relative to the skill directory.".into());
    }

    let target = path_clean::PathClean::clean(&skill.dir.join(requested_path));
    if !target.starts_with(&skill.dir) {
        return Err("Access denied: Skill path escapes the skill directory.".into());
    }
    let real_target =
        fs::canonicalize(&target).map_err(|_| format!("Skill file not found: {requested}"))?;
    if !real_target.starts_with(&skill.dir) {
        return Err("Access denied: Skill file resolves outside the skill directory.".into());
    }
    let metadata = fs::metadata(&real_target).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err(format!("Skill path is not a file: {requested}"));
    }
    if metadata.len() > MAX_SKILL_FILE_BYTES {
        return Err(format!(
            "Skill file is too large ({} bytes; max {}).",
            metadata.len(),
            MAX_SKILL_FILE_BYTES
        ));
    }
    fs::read_to_string(real_target).map_err(|error| error.to_string())
}
