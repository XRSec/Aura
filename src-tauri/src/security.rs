use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

fn canonical_root(root: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(root).map_err(|error| format!("Filesystem Root is unavailable: {error}"))
}

fn lexical_candidate(root: &Path, target: &Path) -> PathBuf {
    if target.is_absolute() {
        path_clean::PathClean::clean(target)
    } else {
        path_clean::PathClean::clean(&root.join(target))
    }
}

fn ensure_inside(root: &Path, candidate: &Path) -> Result<(), String> {
    if candidate.starts_with(root) {
        Ok(())
    } else {
        Err("Access denied: Path resolves outside the configured Filesystem Root.".into())
    }
}

pub fn resolve_existing_path(root: &Path, target: &Path) -> Result<PathBuf, String> {
    let root = canonical_root(root)?;
    let candidate = lexical_candidate(&root, target);
    ensure_inside(&root, &candidate)?;
    let real =
        fs::canonicalize(&candidate).map_err(|error| format!("Path is unavailable: {error}"))?;
    ensure_inside(&root, &real)?;
    Ok(real)
}

pub fn resolve_write_path(root: &Path, target: &Path) -> Result<PathBuf, String> {
    let root = canonical_root(root)?;
    let candidate = lexical_candidate(&root, target);
    ensure_inside(&root, &candidate)?;

    if fs::symlink_metadata(&candidate).is_ok() {
        let real = fs::canonicalize(&candidate)
            .map_err(|error| format!("Path is unavailable: {error}"))?;
        ensure_inside(&root, &real)?;
        return Ok(candidate);
    }

    let mut ancestor = candidate
        .parent()
        .ok_or_else(|| "Path has no parent directory.".to_string())?;
    while fs::symlink_metadata(ancestor).is_err() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| "Unable to resolve a safe parent directory.".to_string())?;
    }
    let real_ancestor = fs::canonicalize(ancestor)
        .map_err(|error| format!("Parent directory is unavailable: {error}"))?;
    ensure_inside(&root, &real_ancestor)?;
    Ok(candidate)
}

fn has_restricted_shell_syntax(command: &str) -> bool {
    let mut quote = None::<char>;
    let mut escaped = false;
    let chars = command.chars().collect::<Vec<_>>();
    let mut index = 0;

    while index < chars.len() {
        let ch = chars[index];
        if ch == '\n' || ch == '\r' {
            return true;
        }
        if escaped {
            escaped = false;
            index += 1;
            continue;
        }
        if ch == '\\' && quote != Some('\'') {
            escaped = true;
            index += 1;
            continue;
        }
        match quote {
            Some('\'') => {
                if ch == '\'' {
                    quote = None;
                }
            }
            Some('"') => {
                if ch == '"' {
                    quote = None;
                } else if ch == '`' || (ch == '$' && chars.get(index + 1) == Some(&'(')) {
                    return true;
                }
            }
            None => match ch {
                '\'' | '"' => quote = Some(ch),
                ';' | '|' | '&' | '<' | '>' | '(' | ')' | '`' => return true,
                '$' if chars.get(index + 1) == Some(&'(') => return true,
                _ => {}
            },
            _ => unreachable!(),
        }
        index += 1;
    }
    false
}

pub fn validate_shell_policy(
    command: &str,
    policy: &str,
    allowlist: &HashSet<String>,
    denylist: &HashSet<String>,
) -> Result<String, String> {
    let command = command.trim();
    let base = command.split_whitespace().next().unwrap_or_default();
    if base.is_empty() {
        return Err("Command cannot be empty.".into());
    }

    match policy {
        "unrestricted" => Ok(base.to_string()),
        "allowlist" | "denylist" => {
            if has_restricted_shell_syntax(command) {
                return Err(
                    "Shell chaining, redirection, grouping, or command substitution is not allowed under a restricted Shell Policy."
                        .into(),
                );
            }
            if policy == "allowlist" && !allowlist.contains(base) {
                return Err(format!(
                    "Command '{base}' is not in Aura's shell allowlist."
                ));
            }
            if policy == "denylist" && denylist.contains(base) {
                return Err(format!(
                    "Command '{base}' is explicitly blocked by Aura's denylist."
                ));
            }
            Ok(base.to_string())
        }
        other => Err(format!("Unknown Aura Shell Policy '{other}'.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restricted_shell_rejects_chaining_and_substitution() {
        let allow = HashSet::from(["echo".to_string()]);
        let deny = HashSet::new();
        assert!(validate_shell_policy("echo ok", "allowlist", &allow, &deny).is_ok());
        assert!(validate_shell_policy("echo ok; uname -a", "allowlist", &allow, &deny).is_err());
        assert!(validate_shell_policy("echo $(uname)", "allowlist", &allow, &deny).is_err());
        assert!(validate_shell_policy("echo 'a;b'", "allowlist", &allow, &deny).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn existing_path_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let base = std::env::temp_dir().join(format!("aura-security-{}", uuid::Uuid::new_v4()));
        let root = base.join("root");
        let outside = base.join("outside");
        fs::create_dir_all(&root).expect("root");
        fs::create_dir_all(&outside).expect("outside");
        fs::write(outside.join("secret.txt"), "secret").expect("secret");
        symlink(outside.join("secret.txt"), root.join("link.txt")).expect("symlink");

        assert!(resolve_existing_path(&root, Path::new("link.txt")).is_err());
        let _ = fs::remove_dir_all(base);
    }
}
