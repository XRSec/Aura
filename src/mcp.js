const { randomUUID } = require('node:crypto');
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { isInitializeRequest } = require("@modelcontextprotocol/sdk/types.js");
const { z } = require("zod");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const configManager = require("./config");
const SkillRegistry = require("./skills");
const { PiBridge, jsonSchemaToZod } = require("./pi-bridge");
const { EventEmitter } = require("events");

class McpGateway extends EventEmitter {
  constructor(authServer) {
    super();
    this.authServer = authServer; // Reference to Express app to attach MCP routes
    this.mcpPath = authServer.mcpPath;
    this.sessions = new Map();
    this.skillRegistry = new SkillRegistry(() => configManager.get('fsRoot') || '~/');
    this.legacySession = null;

    this.setupRoutes();
  }

  async createMcpServerInstance() {
    const piEnabled = configManager.get('piEnabled') === true;
    const piBridge = new PiBridge({
      getFsRoot: () => configManager.get('fsRoot') || '~/',
      getAllowPiModelTools: () => configManager.get('piAllowModelTools') === true,
      getShellPolicy: () => configManager.get('shellPolicy') || 'unrestricted',
      getShellAllowlist: () => configManager.get('shellAllowlist') || [],
      getShellDenylist: () => configManager.get('shellDenylist') || [],
      onStatus: (level, message, detail) => {
        this.logConnection('pi_bridge', level === 'warn' ? 'Warning' : 'Ready', { message, detail });
      }
    });
    if (piEnabled) {
      await piBridge.initialize();
      if (piBridge.available) {
        const configuredPiTools = Array.isArray(configManager.get('piTools')) ? configManager.get('piTools') : [];
        if (configuredPiTools.length > 0) {
          await piBridge.enableTools(configuredPiTools, configuredPiTools);
        }
      }
    }

    const configuredInstructions = configManager.get('mcpInstructions');
    const server = new McpServer(
      {
        name: "Aura-MCP",
        version: "1.0.0"
      },
      {
        instructions: typeof configuredInstructions === 'string' ? configuredInstructions : ''
      }
    );
    this.setupToolsForServer(server, piBridge, { piEnabled });
    return { server, piBridge };
  }

  logExecution(tool, params, result) {
    const isDebug = configManager.get('debugMode') === true;
    const httpCtx = this.authServer?.httpContext?.getStore();
    if (httpCtx) {
      httpCtx.hasToolCall = true;
    }

    let httpInfo = null;
    if (httpCtx) {
      httpInfo = {
        method: httpCtx.method,
        url: httpCtx.url,
        ip: httpCtx.ip,
        auth: httpCtx.auth,
        requestId: httpCtx.requestId,
        elapsedMs: Date.now() - (httpCtx.started || Date.now())
      };
      if (isDebug) {
        httpInfo.headers = httpCtx.headers;
        httpInfo.userAgent = httpCtx.userAgent;
        if (httpCtx.query && Object.keys(httpCtx.query).length > 0) {
          httpInfo.query = httpCtx.query;
        }
      }
    }

    this.emit("execution-log", {
      timestamp: new Date().toISOString(),
      tool,
      params,
      result: result.isError ? "Error" : "Success",
      output: result.output,
      error: result.error,
      duration: result.duration,
      http: httpInfo
    });
  }

  logConnection(_event, _result, _params = {}) {
    // Connection lifecycle events are internal runtime state, not AI tool invocations.
    // They are not added to MCP Tools log.
  }

  isAuthorized(req) {
    // 1. In OpenAI Secure MCP Tunnel mode, authentication is handled at the tunnel transport layer (Authentication: None).
    const currentMode = configManager.get('tunnelMode');
    if (currentMode === 'openai') {
      return true;
    }

    // 2. In Cloudflare / Custom OAuth mode, verify Bearer access token.
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return this.authServer.isAccessTokenValid(token);
  }

  // Ensure path is within the allowed root
  resolveSafePath(targetPath) {
    let fsRoot = configManager.get('fsRoot') || '~/';
    if (fsRoot.startsWith('~/')) {
      fsRoot = path.join(os.homedir(), fsRoot.slice(2));
    }
    const resolvedRoot = path.resolve(fsRoot);
    const resolvedTarget = path.resolve(resolvedRoot, targetPath);
    
    if (!resolvedTarget.startsWith(resolvedRoot)) {
      throw new Error('Access denied: Path is outside the configured file system root.');
    }
    return resolvedTarget;
  }

  setupToolsForServer(server, piBridge, { piEnabled = false } = {}) {
    const defaultCapabilitiesEnabled = configManager.get('defaultCapabilitiesEnabled') !== false;
    const configuredDefaultTools = Array.isArray(configManager.get('defaultTools')) ? configManager.get('defaultTools') : [];
    const configuredDefaultToolNames = new Set(configuredDefaultTools);
    const defaultToolEnabled = name => defaultCapabilitiesEnabled && configuredDefaultToolNames.has(name);
    const configuredPiTools = Array.isArray(configManager.get('piTools')) ? configManager.get('piTools') : [];
    const configuredPiToolNames = new Set(configuredPiTools);
    const exposedPiTools = piEnabled && piBridge.available
      ? piBridge.listTools().filter(tool => configuredPiToolNames.has(tool.name))
      : [];
    const exposedPiToolNames = exposedPiTools.map(tool => tool.name);
    const usePiResources = piEnabled && piBridge.available;
    const piSkillCatalog = usePiResources
      ? piBridge.listSkills().map(skill => `- ${skill.name}: ${skill.description || 'No description provided.'}`).join('\n')
      : this.skillRegistry.catalogText();

    if (defaultToolEnabled('list_skills')) {
    server.tool(
      "list_skills",
      "List reusable Skills. When Pi is installed, Aura reads the exact Skill registry discovered by Pi's ResourceLoader; otherwise Aura falls back to local Skill discovery.",
      async () => {
        const startedAt = Date.now();
        try {
          let text;
          let count;
          if (usePiResources) {
            const skills = piBridge.listSkills();
            count = skills.length;
            text = skills.length
              ? skills.map(skill => {
                  const source = skill.sourceInfo?.source || skill.sourceInfo?.path || 'pi';
                  return `- ${skill.name}: ${skill.description || 'No description provided.'}\n  source: ${source}\n  directory: ${skill.baseDir}`;
                }).join('\n')
              : '(No Pi Skills discovered.)';
          } else {
            const skills = this.skillRegistry.list();
            count = skills.length;
            text = skills.length
              ? skills.map(skill => `- ${skill.name}: ${skill.description || 'No description provided.'}\n  source: ${skill.source}\n  directory: ${skill.dir}`).join('\n')
              : '(No local Skills discovered.)';
          }
          const duration = Date.now() - startedAt;
          this.logExecution("list_skills", {}, { isError: false, output: `${count} skills discovered`, duration });
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const duration = Date.now() - startedAt;
          this.logExecution("list_skills", {}, { isError: true, error: err.message, duration });
          return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        }
      }
    );

    }

    if (defaultToolEnabled('read_skill')) {
    server.tool(
      "read_skill",
      `Read a Skill's SKILL.md or another text file relative to that Skill directory. When Pi is available, this reads the Skill selected by Pi's own ResourceLoader. If SKILL.md references a relative file, call read_skill again with the same skill and that relative path.\n\nAvailable Skills:\n${piSkillCatalog || '(No Skills discovered.)'}`,
      {
        skill: z.string().describe("Skill name from the available Skills catalog"),
        path: z.string().optional().describe("Relative file path inside the Skill directory; defaults to SKILL.md")
      },
      async ({ skill, path: skillPath }) => {
        const startedAt = Date.now();
        try {
          const result = usePiResources
            ? piBridge.readSkill(skill, skillPath || 'SKILL.md')
            : this.skillRegistry.read(skill, skillPath || 'SKILL.md');
          const duration = Date.now() - startedAt;
          const skillDir = result.skill.baseDir || result.skill.dir;
          this.logExecution("read_skill", { skill, path: result.requestedPath }, {
            isError: false,
            output: `Read ${result.bytes} bytes from ${result.skill.name}/${result.requestedPath}`,
            duration
          });
          const header = [
            `Skill: ${result.skill.name}`,
            `Skill directory: ${skillDir}`,
            `File: ${result.requestedPath}`,
            ''
          ].join('\n');
          return { content: [{ type: "text", text: header + result.content }] };
        } catch (err) {
          const duration = Date.now() - startedAt;
          this.logExecution("read_skill", { skill, path: skillPath || 'SKILL.md' }, { isError: true, error: err.message, duration });
          return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        }
      }
    );

    }

    if (piEnabled) {
    const capabilityDescription = usePiResources
      ? `Load Pi Skills on demand. Pi tools selected in Aura Settings are already exposed and enabled when the MCP session connects, so call those tools directly. Aura invokes Pi tool execute() directly and never calls Pi session.prompt().`
      : `Pi capabilities are disabled in Aura Settings. Core Aura tools and locally discovered Skills remain usable.`;

    server.registerTool(
      "request_capabilities",
      {
        description: capabilityDescription,
        inputSchema: z.object({
          skills: z.array(z.string()).min(1).max(16).describe('Pi Skill names to load into the current context'),
          reason: z.string().min(1).optional().describe('Why these Skills are needed')
        })
      },
      async ({ skills, reason = '' }) => {
        const startedAt = Date.now();
        try {
          if (!piEnabled) {
            throw new Error('Pi capabilities are disabled in Aura Settings.');
          }
          if (!piBridge.available) {
            throw new Error(piBridge.initError?.message || 'Pi bridge is unavailable.');
          }

          const skillActivation = piBridge.activateSkills(skills);
          const lines = [];
          if (reason) lines.push(`Reason: ${reason}`);
          if (skillActivation.unknown.length) lines.push(`Unknown Skills: ${skillActivation.unknown.join(', ')}`);

          for (const skill of skillActivation.activated) {
            if (skill.skipped) {
              lines.push(`Skill ${skill.name}: ${skill.reason}`);
            } else {
              lines.push('', skill.content);
            }
          }
          if (!lines.length) lines.push('No Skills were loaded.');

          const duration = Date.now() - startedAt;
          this.logExecution("request_capabilities", { skills, reason }, {
            isError: false,
            output: `Loaded ${skillActivation.activated.filter(item => !item.skipped).length} Skills`,
            duration
          });
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        } catch (err) {
          const duration = Date.now() - startedAt;
          this.logExecution("request_capabilities", { skills, reason }, { isError: true, error: err.message, duration });
          return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
      }
    );

    }

    if (usePiResources) {
      for (const piTool of exposedPiTools) {
        try {
          server.registerTool(
            piTool.name,
            {
              description: `${piTool.description || 'Pi tool.'}\n\nSource: Pi ${piBridge.version}${piTool.usesPiDefaultModel ? ' · May invoke the Pi default model.' : ' · Direct tool execution; no Pi agent turn.'}`,
              inputSchema: jsonSchemaToZod(piTool.parameters),
              _meta: {
                aura: {
                  source: 'pi',
                  category: piTool.category,
                  usesPiDefaultModel: piTool.usesPiDefaultModel
                }
              }
            },
            async (args, extra) => {
              const startedAt = Date.now();
              try {
                const result = await piBridge.executeTool(piTool.name, args || {}, { signal: extra?.signal });
                const duration = Date.now() - startedAt;
                const output = result.logText.length > 5000
                  ? `${result.logText.slice(0, 5000)}… [truncated ${result.logText.length} chars]`
                  : (result.logText || '(Non-text result)');
                this.logExecution(piTool.name, args || {}, { isError: result.isError, output, duration });
                return { content: result.content, isError: result.isError };
              } catch (err) {
                const duration = Date.now() - startedAt;
                this.logExecution(piTool.name, args || {}, { isError: true, error: err.message, duration });
                return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
              }
            }
          );
        } catch (error) {
          this.logConnection('pi_tool_register', 'Skipped', { tool: piTool.name, error: error.message });
        }
      }
    }

    if (defaultToolEnabled('read_file')) {
    // 1. FileSystem: Read
    server.tool("read_file",
      { path: z.string().describe("Relative path to the file to read") },
      async ({ path: targetPath }) => {
        const startedAt = Date.now();
        try {
          const safePath = this.resolveSafePath(targetPath);
          const content = fs.readFileSync(safePath, 'utf8');
          const duration = Date.now() - startedAt;
          this.logExecution("read_file", { path: targetPath }, { isError: false, output: content.length > 5000 ? `${content.slice(0, 5000)}… [truncated ${content.length} chars]` : content, duration });
          return { content: [{ type: "text", text: content }] };
        } catch (err) {
          const duration = Date.now() - startedAt;
          this.logExecution("read_file", { path: targetPath }, { isError: true, error: err.message, duration });
          return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        }
      }
    );

    }

    if (defaultToolEnabled('write_file')) {
    // 2. FileSystem: Write
    server.tool("write_file",
      {
        path: z.string().describe("Relative path to write"),
        content: z.string().describe("Content to write")
      },
      async ({ path: targetPath, content }) => {
        const startedAt = Date.now();
        try {
          const safePath = this.resolveSafePath(targetPath);
          fs.mkdirSync(path.dirname(safePath), { recursive: true });
          fs.writeFileSync(safePath, content, 'utf8');
          const duration = Date.now() - startedAt;
          this.logExecution("write_file", { path: targetPath, bytes: content.length }, { isError: false, output: `Successfully wrote ${content.length} bytes to ${targetPath}`, duration });
          return { content: [{ type: "text", text: `Successfully wrote to ${targetPath}` }] };
        } catch (err) {
          const duration = Date.now() - startedAt;
          this.logExecution("write_file", { path: targetPath }, { isError: true, error: err.message, duration });
          return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        }
      }
    );

    }

    if (defaultToolEnabled('execute_shell')) {
    // 3. Shell Execution (Unrestricted/Allow/Deny)
    server.tool("execute_shell",
      "Execute a shell command under Aura's shell policy. If a selected Pi tool already provides the requested capability, call that dedicated tool directly instead of emulating it with shell.",
      { command: z.string().describe("Shell command to execute") },
      async ({ command }) => {
        const startedAt = Date.now();
        const policy = configManager.get('shellPolicy') || 'unrestricted';
        const allowlist = configManager.get('shellAllowlist') || [];
        const denylist = configManager.get('shellDenylist') || [];
        const baseCmd = command.trim().split(/\s+/)[0];

        if (policy === 'denylist') {
          if (denylist.includes(baseCmd)) {
            const duration = Date.now() - startedAt;
            this.logExecution("execute_shell", { command, policy }, { isError: true, error: `Command '${baseCmd}' is explicitly blocked by denylist.`, duration });
            return { content: [{ type: "text", text: `Error: Command '${baseCmd}' is explicitly blocked by denylist.` }], isError: true };
          }
        } else if (policy === 'allowlist') {
          if (!allowlist.includes(baseCmd)) {
            const duration = Date.now() - startedAt;
            this.logExecution("execute_shell", { command, policy }, { isError: true, error: `Command '${baseCmd}' is not in the allowlist.`, duration });
            return { content: [{ type: "text", text: `Error: Command '${baseCmd}' is not in the allowlist.` }], isError: true };
          }
        }

        return new Promise((resolve) => {
          exec(command, { cwd: os.homedir() }, (error, stdout, stderr) => {
            const duration = Date.now() - startedAt;
            let output = stdout;
            if (stderr) output += `\nSTDERR:\n${stderr}`;
            if (error) output += `\nERROR:\n${error.message}`;

            this.logExecution("execute_shell", { command, policy }, {
              isError: !!error,
              output: output.trim() || "(No output)",
              error: error ? error.message : null,
              duration
            });
            resolve({ content: [{ type: "text", text: output.trim() || "Command executed successfully with no output." }], isError: !!error });
          });
        });
      }
    );
    }
  }

  setupRoutes() {
    const app = this.authServer.app;
    const streamablePath = this.mcpPath;
    const sessions = this.sessions;

    app.options(streamablePath, (req, res) => {
      res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id'
      }).status(204).end();
    });

    app.all(streamablePath, async (req, res) => {
      if (!this.isAuthorized(req)) {
        const metadataUrl = `${this.authServer.resourceUrl()}/.well-known/oauth-protected-resource`;
        this.logConnection('mcp_connect', 'Unauthorized', { method: req.method, path: streamablePath });
        return res
          .set('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl}"`)
          .status(401)
          .json({ error: 'unauthorized' });
      }

      try {
        const sessionId = req.headers['mcp-session-id'];
        let session = sessionId ? sessions.get(sessionId) : null;

        if (!session && req.method === 'POST' && isInitializeRequest(req.body)) {
          const { server: mcpServer, piBridge } = await this.createMcpServerInstance();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: false,
            onsessioninitialized: id => {
              sessions.set(id, { transport, server: mcpServer, piBridge });
              this.logConnection('mcp_connect', 'Connected', { sessionId: id, path: streamablePath });
            }
          });
          transport.onclose = () => {
            piBridge.dispose();
            if (transport.sessionId) sessions.delete(transport.sessionId);
            this.logConnection('mcp_disconnect', 'Closed', { sessionId: transport.sessionId });
          };
          await mcpServer.connect(transport);
          session = { transport, server: mcpServer, piBridge };
        }

        if (!session || !session.transport) {
          this.logConnection('mcp_request', 'Error', { method: req.method, reason: 'Missing MCP session' });
          return res.status(400).json({ error: 'missing_mcp_session' });
        }
        this.emit("raw-request", { method: req.body?.method, params: req.body?.params, id: req.body?.id });
        await session.transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('MCP request error:', error);
        this.logConnection('mcp_request', 'Error', { message: error.message });
        if (!res.headersSent) res.status(500).json({ error: 'mcp_internal_error' });
      }
    });

    // Deprecated HTTP+SSE compatibility for older clients.
    const ssePath = `${streamablePath}/sse`;
    const messagesPath = `${streamablePath}/messages`;
    app.get(ssePath, async (req, res) => {
      if (!this.isAuthorized(req)) {
        this.logConnection('mcp_sse', 'Unauthorized', { path: ssePath });
        return res.status(401).send('Unauthorized');
      }
      try {
        if (this.legacySession) {
          try { await this.legacySession.server.close(); } catch {}
          this.legacySession.piBridge.dispose();
          this.legacySession = null;
        }

        const { server: mcpServer, piBridge } = await this.createMcpServerInstance();
        const legacyTransport = new SSEServerTransport(messagesPath, res);
        this.legacySession = { transport: legacyTransport, server: mcpServer, piBridge };
        legacyTransport.onclose = () => {
          piBridge.dispose();
          if (this.legacySession?.transport === legacyTransport) this.legacySession = null;
          this.logConnection('mcp_sse', 'Closed', { path: ssePath });
        };
        await mcpServer.connect(legacyTransport);
        this.logConnection('mcp_sse', 'Connected', { path: ssePath });
      } catch (error) {
        this.logConnection('mcp_sse', 'Error', { message: error.message });
        if (!res.headersSent) res.status(500).send('MCP connection failed');
      }
    });
    app.post(messagesPath, async (req, res) => {
      if (!this.isAuthorized(req)) return res.status(401).send('Unauthorized');
      if (!this.legacySession?.transport) return res.status(400).send('No active SSE connection');
      await this.legacySession.transport.handlePostMessage(req, res, req.body);
    });
  }

  async close() {
    const activeSessions = Array.from(this.sessions.values());
    this.sessions.clear();
    for (const session of activeSessions) {
      session.piBridge?.dispose();
      try { await session.server?.close(); } catch {}
    }

    if (this.legacySession) {
      const legacy = this.legacySession;
      this.legacySession = null;
      legacy.piBridge?.dispose();
      try { await legacy.server?.close(); } catch {}
    }
  }
}

module.exports = McpGateway;
