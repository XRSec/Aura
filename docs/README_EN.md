<div align="center">
  <img src="screenshots/aura-icon.png" alt="Aura" width="120" />
  <h1>Aura</h1>
  <p><strong>Securely connect AI to your local machine.</strong></p>
  <p>A lightweight, zero-config desktop MCP Bridge powered by Tauri 2 and Rust native MCP Runtime.</p>

  <p>
    <a href="README.md">简体中文</a> ·
    <a href="README_EN.md">English</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/version-1.0.1-blue" alt="Version" />
    <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
    <img src="https://img.shields.io/badge/MCP-compatible-6f42c1" alt="MCP" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platform" />
  </p>
</div>

---

## What is Aura?

**Aura is a desktop MCP Bridge that runs locally on your computer.**

It exposes local files, shell commands, Skills, and optional Pi Tools to ChatGPT and other MCP-compatible AI clients through a secured and bounded MCP interface.

You don't need to manually configure separate MCP servers, OAuth flows, token management, reverse proxy tunnels, logging, and sandbox policies. Aura unifies them in a lightweight (~4 MB) desktop application.

```text
ChatGPT / MCP Client
        │
        │ HTTPS / MCP
        ▼
Cloudflare / OpenAI Secure Tunnel / Custom Proxy
        │
        ▼
   Aura (Tauri + Rust MCP)
  ┌─────┼──────────────────────────┐
  │     │                          │
Files  Shell   Skills          Pi Tools
  │     │                          │
  └─────┴──── Policy & Auth ───────┘
              │
              ▼
        Your Local Machine
```

## Why Aura?

- **Ultra Lightweight (Tauri 2 + Rust)**: Only ~4 MB package size, using system WebView and native Rust backend without bundled Node or Chromium.
- **Unified Management**: Connect, authorize, monitor logs, and configure tunnels in one clean UI.
- **Fine-grained Security**: Strict Filesystem Root boundaries, Shell execution policies, DNS rebinding protection, and system keyring integration.
- **Multiple Tunnel Modes**: Built-in support for Cloudflare Named Tunnel, Cloudflare Quick Tunnel, OpenAI Secure MCP Tunnel, and Custom Reverse Proxies.
- **Pi Ecosystem Integration**: Uses your local Node (>=22.19) and Pi Coding Agent registry as an allowlisted, on-demand Tool source, while executing the original Pi Tool directly without calling `session.prompt()`.

## Core Capabilities

### Native Rust MCP Server

| Tool | Purpose |
| --- | --- |
| `read_file` | Read UTF-8 files inside the configured Filesystem Root |
| `write_file` | Create or overwrite UTF-8 files inside Filesystem Root |
| `execute_shell` | Execute shell commands strictly governed by Shell Policy |
| `list_skills` | Discover and list available Skills |
| `read_skill` | Read `SKILL.md` and referenced files inside a Skill directory |

### Pi Tools / Skills

When Pi is installed, Aura can reuse the Pi Tool and Skill registries and add capabilities to the current MCP session on demand:

- Pi Tools selected in Aura Settings form the **requestable allowlist**. They do not all start active in the Pi session.
- Pi Tools start inactive and are activated by exact name through `request_capabilities`.
- Tool activation is **only-add / ensure-active** for the lifetime of the current session: successfully activated Tools remain active, and requesting a smaller set later does not remove them.
- `request_capabilities` classifies Tool requests as `Enabled`, `Already active`, `Blocked`, or `Unknown`. `Enabled` and `Already active` include the Tool's real Pi-registry `name`, `description`, and complete `inputSchema`; `Blocked` and `Unknown` do not disclose a Schema.
- Standard MCP clients that support dynamic Tool discovery receive `notifications/tools/list_changed` when the active set changes, then can call `tools/list` again and invoke the newly visible Pi Tool directly.
- Some clients, including the currently tested ChatGPT connector behavior, do not hot-refresh direct Tool Schemas inside an existing connection. Aura therefore provides a compatibility path: `request_capabilities → embedded Pi Schema → execute_pi_tool → original Pi Tool`.
- `execute_pi_tool` is not an activation mechanism. Execution still requires both Aura Settings allowlist membership and Pi active state, followed by the existing Filesystem Root and Shell Policy checks.
- Aura invokes the original Pi Tool `execute()` implementation directly; it does not route Tool execution through Pi Agent `session.prompt()`.
- Skills can also be loaded on demand with `request_capabilities`, or inspected through `list_skills` / `read_skill`.

```text
                   request_capabilities
                          │
                 Pi active state change
                          │
           ┌──────────────┴──────────────┐
           │                             │
     Standard MCP client             ChatGPT
           │                             │
  notifications/tools/list_changed      embedded Pi Schema
           │                             │
     second tools/list              execute_pi_tool
           │                             │
      direct Pi Tool                original Pi Tool
           │                             │
           └──────────────┬──────────────┘
                          │
        allowlist + active state + authority checks
```

## Quick Start

```bash
git clone https://github.com/XRSec/Aura.git
cd Aura
npm install
npm run dev
```

## Build

```bash
# Development
npm run dev

# Release Build
npm run build

# macOS App & DMG
npm run build:mac

# Windows NSIS
npm run build:win

# Linux AppImage & DEB
npm run build:linux
```

## License

MIT
