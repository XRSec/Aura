# Aura MCP Connector

Aura is a lightweight, zero-configuration MCP (Model Context Protocol) connector designed for users who want a frictionless bridge between ChatGPT / Claude and their local machine.

## Philosophy
- **Zero Configuration**: No more copying Client IDs, Secrets, or Redirect URIs. Aura implements the latest **MCP 2026-07-28** standard with **CIMD (Client ID Metadata Documents)**. Just paste your Aura URL into ChatGPT, and authenticate via a web prompt.
- **Unrestricted by Default**: We trust the developer. When the shell allowlist and denylist are empty, Aura runs in completely unrestricted mode, giving the AI full access to your terminal. 
- **Safe Bounds**: File access defaults to `~/` (your home directory), providing a natural sandbox that covers 99% of development needs without the tediousness of adding individual project folders.
- **Pluggable Tunnels**: Supports:
  - **Cloudflare Named Tunnel**: Reads your local `~/.cloudflared/config.yml` configuration and custom domain.
  - **Cloudflare Quick Tunnel**: Generates temporary random URLs for testing.
  - **OpenAI Secure MCP Tunnel**: Works with official `openai/tunnel-client` for zero-configuration private connections directly into ChatGPT (Authentication: None).
  - **Custom Tunnel**: Bring your own reverse proxy (ngrok, Caddy, FRP).
  - Aura calls your system PATH binaries directly and **never bundles opaque binaries**.

## Features
- **Electron GUI**: A minimalistic UI that sits quietly on your desktop, using native OS Keychains (`safeStorage`) to store your admin password securely.
- **Dynamic Token Expiry**: During the web OAuth flow, you (the human) can decide how long the AI is authorized for (`1h`, `24h`, `7d`, or `never`).
- **Flexible Security**: Control your shell policies in real-time from the GUI (Allowlist / Denylist).
- **Activity Log & Revocation**: Real-time auditing of tool executions and one-click active token revocation.

## Installation

```bash
cd Aura
npm install
npm run start
```

## How to Connect to ChatGPT
1. Launch Aura.
2. Aura will automatically spawn a Cloudflare tunnel and display your public `https://*.trycloudflare.com` URL in the UI.
3. Open ChatGPT, add a new MCP Server, and paste the URL.
4. ChatGPT will recognize the CIMD endpoint and open a web authorization page.
5. Enter your Aura Admin Password (which you set in the Aura GUI) and select a token duration.
6. Click Authorize. You're connected!

---
*Developed iteratively to combine the best parts of `aki-mcp-sv`, `aevra`, and `chat-on-steroids` into one thin, elegant core.*
