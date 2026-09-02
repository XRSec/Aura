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
    const piBridge = new PiBridge({
      getFsRoot: () => configManager.get('fsRoot') || '~/',
      getAllowPiModelTools: () => configManager.get('piAllowModelTools') === true,
      onStatus: (level, message, detail) => {
        this.logConnection('pi_bridge', level === 'warn' ? 'Warning' : 'Ready', { message, detail });
      }
    });
    await piBridge.initialize();

    const server = new McpServer({
      name: "Aura-MCP",
      version: "1.0.0"
    });
    this.setupToolsForServer(server, piBridge);
    return { server, piBridge };
  }

  logExecution(tool, params, result) {
    this.emit("execution-log", {
      timestamp: new Date().toISOString(),
      tool,
      params,
      result: result.isError ? "Error" : "Success",
      output: result.output,
      error: result.error,
      duration: result.duration
    });
  }

  logConnection(tool, result, params = {}) {
    this.emit("execution-log", {
      timestamp: new Date().toISOString(),
      tool,
      params,
      result
    });
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

  setupToolsForServer(server, piBridge) {
    const piToolHandles = new Map();
    const piSkillCatalog = piBridge.available
      ? piBridge.listSkills().map(skill => `- ${skill.name}: ${skill.description || 'No description provided.'}`).join('\n')
      : this.skillRegistry.catalogText();

    server.tool(
      "list_skills",
      "List reusable Skills. When Pi is installed, Aura reads the exact Skill registry discovered by Pi's ResourceLoader; otherwise Aura falls back to local Skill discovery.",
      async () => {
        const startedAt = Date.now();
        try {
          let text;
          let count;
          if (piBridge.available) {
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
          const result = piBridge.available
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

    const capabilityDescription = piBridge.available
      ? `Enable registered Pi tools or load Pi Skills only when needed. Tool schemas are added to this MCP session after activation. Aura invokes Pi tool execute() directly and never calls Pi session.prompt(), so the bridge itself does not spend Pi default-model tokens. Pi model-backed tools are blocked unless Aura's piAllowModelTools setting is enabled.\n\nInactive capabilities:\n${piBridge.catalogText()}`
      : `Pi capability bridge is unavailable. Core Aura tools and locally discovered Skills remain usable.\n\n${piBridge.catalogText()}`;

    server.registerTool(
      "request_capabilities",
      {
        description: capabilityDescription,
        inputSchema: z.object({
          tools: z.array(z.string()).max(16).optional().describe('Pi tool names to enable in this MCP session'),
          skills: z.array(z.string()).max(16).optional().describe('Pi Skill names to load into the current context'),
          reason: z.string().min(1).optional().describe('Why these capabilities are needed')
        }).refine(value => (value.tools?.length || 0) + (value.skills?.length || 0) > 0, {
          message: 'Request at least one tool or Skill.'
        })
      },
      async ({ tools = [], skills = [], reason = '' }) => {
        const startedAt = Date.now();
        try {
          if (!piBridge.available) {
            throw new Error(piBridge.initError?.message || 'Pi bridge is unavailable.');
          }

          const toolActivation = piBridge.enableTools(tools);
          for (const name of [...toolActivation.enabled, ...toolActivation.alreadyActive]) {
            piToolHandles.get(name)?.enable();
          }
          const skillActivation = piBridge.activateSkills(skills);

          const lines = [];
          if (reason) lines.push(`Reason: ${reason}`);
          if (toolActivation.enabled.length) lines.push(`Enabled Pi tools: ${toolActivation.enabled.join(', ')}`);
          if (toolActivation.alreadyActive.length) lines.push(`Already active: ${toolActivation.alreadyActive.join(', ')}`);
          if (toolActivation.blocked.length) {
            lines.push(`Blocked: ${toolActivation.blocked.map(item => `${item.name} (${item.reason})`).join('; ')}`);
          }
          if (toolActivation.unknown.length) lines.push(`Unknown tools: ${toolActivation.unknown.join(', ')}`);
          if (skillActivation.unknown.length) lines.push(`Unknown Skills: ${skillActivation.unknown.join(', ')}`);

          for (const skill of skillActivation.activated) {
            if (skill.skipped) {
              lines.push(`Skill ${skill.name}: ${skill.reason}`);
            } else {
              lines.push('', skill.content);
            }
          }
          if (!lines.length) lines.push('No capability changes were required.');

          const duration = Date.now() - startedAt;
          this.logExecution("request_capabilities", { tools, skills, reason }, {
            isError: false,
            output: `Enabled ${toolActivation.enabled.length} tools; loaded ${skillActivation.activated.filter(item => !item.skipped).length} Skills`,
            duration
          });
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        } catch (err) {
          const duration = Date.now() - startedAt;
          this.logExecution("request_capabilities", { tools, skills, reason }, { isError: true, error: err.message, duration });
          return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
      }
    );

    if (piBridge.available) {
      for (const piTool of piBridge.listTools()) {
        try {
          const registered = server.registerTool(
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
          registered.disable();
          piToolHandles.set(piTool.name, registered);
        } catch (error) {
          this.logConnection('pi_tool_register', 'Skipped', { tool: piTool.name, error: error.message });
        }
      }
    }

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

    // 3. Shell Execution (Unrestricted/Allow/Deny)
    server.tool("execute_shell",
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
          const mcpServer = this.createMcpServerInstance();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: id => {
              sessions.set(id, { transport, server: mcpServer });
              this.logConnection('mcp_connect', 'Connected', { sessionId: id, path: streamablePath });
            }
          });
          transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
            this.logConnection('mcp_disconnect', 'Closed', { sessionId: transport.sessionId });
          };
          await mcpServer.connect(transport);
          session = { transport, server: mcpServer };
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
    let legacyTransport;
    const ssePath = `${streamablePath}/sse`;
    const messagesPath = `${streamablePath}/messages`;
    app.get(ssePath, async (req, res) => {
      if (!this.isAuthorized(req)) {
        this.logConnection('mcp_sse', 'Unauthorized', { path: ssePath });
        return res.status(401).send('Unauthorized');
      }
      try {
        legacyTransport = new SSEServerTransport(messagesPath, res);
        legacyTransport.onclose = () => this.logConnection('mcp_sse', 'Closed', { path: ssePath });
        await this.mcp.connect(legacyTransport);
        this.logConnection('mcp_sse', 'Connected', { path: ssePath });
      } catch (error) {
        this.logConnection('mcp_sse', 'Error', { message: error.message });
        if (!res.headersSent) res.status(500).send('MCP connection failed');
      }
    });
    app.post(messagesPath, async (req, res) => {
      if (!this.isAuthorized(req)) return res.status(401).send('Unauthorized');
      if (!legacyTransport) return res.status(400).send('No active SSE connection');
      await legacyTransport.handlePostMessage(req, res, req.body);
    });
  }
}

module.exports = McpGateway;
