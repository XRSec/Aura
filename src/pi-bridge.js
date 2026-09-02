const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, fork } = require('child_process');
const { randomUUID } = require('crypto');
const { z } = require('zod');

const MAX_SKILL_FILE_BYTES = 1024 * 1024;
const MAX_ACTIVATED_SKILL_BYTES = 512 * 1024;

// Aura already provides these capabilities itself. Re-exporting Pi's copies would
// create duplicate filesystem/shell authority and weaken Aura's existing policy boundary.
const AURA_OWNED_TOOLS = new Set([
  'request_capabilities'
]);

// These tools can invoke Pi child agents/models. Keep them unavailable unless the
// user explicitly opts in via Aura config so the bridge itself stays token-free.
const PI_DEFAULT_MODEL_TOOLS = new Set(['subagent']);

function expandHome(inputPath) {
  const value = String(inputPath || '').trim();
  if (!value || value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function isWithin(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function oneLine(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function findPackageRoot(startPath) {
  let current = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
  const root = path.parse(current).root;

  while (current && current !== root) {
    const packagePath = path.join(current, 'package.json');
    if (fs.existsSync(packagePath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        if (manifest.name === '@earendil-works/pi-coding-agent' || manifest.name === '@mariozechner/pi-coding-agent') {
          return { root: current, manifest };
        }
      } catch {
        // Continue walking upward.
      }
    }
    current = path.dirname(current);
  }
  return null;
}

function executableCandidates() {
  const candidates = [];
  const add = candidate => {
    if (!candidate) return;
    const resolved = path.resolve(expandHome(candidate));
    if (!candidates.includes(resolved)) candidates.push(resolved);
  };

  if (process.env.AURA_PI_PACKAGE) add(process.env.AURA_PI_PACKAGE);

  const executableName = process.platform === 'win32' ? 'where' : 'which';
  try {
    const output = execFileSync(executableName, ['pi'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of output.split(/\r?\n/)) add(line.trim());
  } catch {
    // Pi may still be installed through NVM but absent from Finder/Electron PATH.
  }

  const nvmVersions = path.join(os.homedir(), '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmVersions)) {
    const versions = fs.readdirSync(nvmVersions, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
      .reverse();
    for (const version of versions) {
      add(path.join(nvmVersions, version, 'bin', process.platform === 'win32' ? 'pi.cmd' : 'pi'));
    }
  }

  return candidates;
}

function parseNodeVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function isCompatiblePiNode(version) {
  const parsed = parseNodeVersion(version);
  if (!parsed) return false;
  const [major, minor, patch] = parsed;
  return major > 22 || (major === 22 && (minor > 19 || (minor === 19 && patch >= 0)));
}

function inspectNodeRuntime(nodePath) {
  if (!nodePath || !fs.existsSync(nodePath)) return null;
  try {
    const version = execFileSync(nodePath, ['-p', 'process.versions.node'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (!isCompatiblePiNode(version)) return null;
    return { nodePath: fs.realpathSync(nodePath), nodeVersion: version };
  } catch {
    return null;
  }
}

function compatibleNodeRuntime(candidate, packageRoot) {
  const candidates = [];
  const add = value => {
    if (!value) return;
    const resolved = path.resolve(expandHome(value));
    if (!candidates.includes(resolved)) candidates.push(resolved);
  };

  if (candidate && fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
    add(path.join(path.dirname(candidate), process.platform === 'win32' ? 'node.exe' : 'node'));
  }

  const marker = `${path.sep}lib${path.sep}node_modules${path.sep}`;
  const markerIndex = packageRoot.indexOf(marker);
  if (markerIndex > 0) {
    const nodePrefix = packageRoot.slice(0, markerIndex);
    add(path.join(nodePrefix, 'bin', process.platform === 'win32' ? 'node.exe' : 'node'));
  }

  try {
    const command = process.platform === 'win32' ? 'where' : 'which';
    const output = execFileSync(command, ['node'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of output.split(/\r?\n/)) add(line.trim());
  } catch {}

  const nvmVersions = path.join(os.homedir(), '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmVersions)) {
    const versions = fs.readdirSync(nvmVersions, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
      .reverse();
    for (const version of versions) {
      add(path.join(nvmVersions, version, 'bin', process.platform === 'win32' ? 'node.exe' : 'node'));
    }
  }

  for (const nodePath of candidates) {
    const runtime = inspectNodeRuntime(nodePath);
    if (runtime) return runtime;
  }
  return null;
}

function locatePiPackage() {
  let foundWithoutRuntime = null;
  for (const candidate of executableCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const stat = fs.statSync(candidate);
      const resolvedCandidate = stat.isDirectory() ? candidate : fs.realpathSync(candidate);
      const found = findPackageRoot(resolvedCandidate);
      if (found) {
        const runtime = compatibleNodeRuntime(candidate, found.root);
        if (runtime) return { ...found, ...runtime };
        foundWithoutRuntime ||= found;
      }
    } catch {
      // Try the next candidate.
    }
  }

  const npmRoots = [];
  try {
    npmRoots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    // npm may not be on Electron's PATH.
  }

  for (const npmRoot of npmRoots.filter(Boolean)) {
    for (const packagePath of [
      path.join(npmRoot, '@earendil-works', 'pi-coding-agent'),
      path.join(npmRoot, '@mariozechner', 'pi-coding-agent'),
      path.join(npmRoot, '@agegr', 'pi-web', 'node_modules', '@earendil-works', 'pi-coding-agent')
    ]) {
      if (!fs.existsSync(packagePath)) continue;
      try {
        const found = findPackageRoot(packagePath);
        if (found) {
          const runtime = compatibleNodeRuntime(null, found.root);
          if (runtime) return { ...found, ...runtime };
          foundWithoutRuntime ||= found;
        }
      } catch {
        // Continue.
      }
    }
  }

  return foundWithoutRuntime;
}

function packageImportEntry(location) {
  const exported = location.manifest.exports?.['.'];
  const relativeEntry = typeof exported === 'string'
    ? exported
    : exported?.import || location.manifest.module || location.manifest.main;
  if (!relativeEntry) throw new Error('Pi package does not expose an import entry.');
  return path.resolve(location.root, relativeEntry);
}

function literalSchema(values) {
  const literals = values.map(value => z.literal(value));
  if (literals.length === 1) return literals[0];
  return z.union(literals);
}

function applyNumberBounds(schema, source) {
  let result = schema;
  if (typeof source.minimum === 'number') result = result.min(source.minimum);
  if (typeof source.maximum === 'number') result = result.max(source.maximum);
  if (typeof source.exclusiveMinimum === 'number') result = result.gt(source.exclusiveMinimum);
  if (typeof source.exclusiveMaximum === 'number') result = result.lt(source.exclusiveMaximum);
  if (typeof source.multipleOf === 'number' && source.multipleOf > 0) result = result.multipleOf(source.multipleOf);
  return result;
}

function jsonSchemaToZod(schema) {
  if (!schema || typeof schema !== 'object') return z.unknown();

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    return z.literal(schema.const).describe(schema.description || '');
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return literalSchema(schema.enum).describe(schema.description || '');
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const variants = schema.anyOf.map(jsonSchemaToZod);
    const union = variants.length === 1 ? variants[0] : z.union(variants);
    return schema.description ? union.describe(schema.description) : union;
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const variants = schema.oneOf.map(jsonSchemaToZod);
    const union = variants.length === 1 ? variants[0] : z.union(variants);
    return schema.description ? union.describe(schema.description) : union;
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    let combined = jsonSchemaToZod(schema.allOf[0]);
    for (const part of schema.allOf.slice(1)) combined = z.intersection(combined, jsonSchemaToZod(part));
    return schema.description ? combined.describe(schema.description) : combined;
  }

  if (Array.isArray(schema.type)) {
    const variants = schema.type.map(type => jsonSchemaToZod({ ...schema, type }));
    return variants.length === 1 ? variants[0] : z.union(variants);
  }

  let result;
  switch (schema.type) {
    case 'object': {
      const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      const shape = {};
      for (const [name, propertySchema] of Object.entries(properties)) {
        const field = jsonSchemaToZod(propertySchema);
        shape[name] = required.has(name) ? field : field.optional();
      }

      if (Object.keys(shape).length === 0 && schema.patternProperties && typeof schema.patternProperties === 'object') {
        const patterns = Object.values(schema.patternProperties);
        if (patterns.length === 1) {
          result = z.record(z.string(), jsonSchemaToZod(patterns[0]));
          break;
        }
      }

      result = z.object(shape);
      if (schema.additionalProperties === false) {
        result = result.strict();
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        result = result.catchall(jsonSchemaToZod(schema.additionalProperties));
      } else {
        result = result.passthrough();
      }

      if (typeof schema.minProperties === 'number') {
        result = result.refine(value => Object.keys(value).length >= schema.minProperties, `Expected at least ${schema.minProperties} properties`);
      }
      if (typeof schema.maxProperties === 'number') {
        result = result.refine(value => Object.keys(value).length <= schema.maxProperties, `Expected at most ${schema.maxProperties} properties`);
      }
      break;
    }
    case 'array': {
      if (Array.isArray(schema.items)) {
        result = z.tuple(schema.items.map(jsonSchemaToZod));
      } else {
        result = z.array(jsonSchemaToZod(schema.items || {}));
      }
      if (typeof schema.minItems === 'number') result = result.min(schema.minItems);
      if (typeof schema.maxItems === 'number') result = result.max(schema.maxItems);
      break;
    }
    case 'string': {
      result = z.string();
      if (typeof schema.minLength === 'number') result = result.min(schema.minLength);
      if (typeof schema.maxLength === 'number') result = result.max(schema.maxLength);
      if (typeof schema.pattern === 'string') {
        try { result = result.regex(new RegExp(schema.pattern)); } catch {}
      }
      break;
    }
    case 'integer':
      result = applyNumberBounds(z.number().int(), schema);
      break;
    case 'number':
      result = applyNumberBounds(z.number(), schema);
      break;
    case 'boolean':
      result = z.boolean();
      break;
    case 'null':
      result = z.null();
      break;
    default:
      result = z.unknown();
      break;
  }

  return schema.description ? result.describe(schema.description) : result;
}

function classifyTool(name) {
  if (PI_DEFAULT_MODEL_TOOLS.has(name)) return 'pi-model';
  if (name.startsWith('gpt_')) return 'external-model';
  if (name === 'web_search' || name === 'source_check' || name === 'fetch_content' || name === 'get_search_content') return 'network';
  if (name === 'mcp' || name === 'mcpScript' || name.startsWith('mcp__')) return 'mcp';
  return 'tool';
}

function toolResultText(result) {
  if (!result || !Array.isArray(result.content)) return '';
  return result.content
    .map(item => item?.type === 'text' ? item.text : `[${item?.type || 'content'}]`)
    .join('\n')
    .trim();
}

class PiBridge {
  constructor({
    getFsRoot = () => '~/',
    getAllowPiModelTools = () => false,
    getShellPolicy = () => 'unrestricted',
    getShellAllowlist = () => [],
    getShellDenylist = () => [],
    onStatus = null
  } = {}) {
    this.getFsRoot = getFsRoot;
    this.getAllowPiModelTools = getAllowPiModelTools;
    this.getShellPolicy = getShellPolicy;
    this.getShellAllowlist = getShellAllowlist;
    this.getShellDenylist = getShellDenylist;
    this.onStatus = onStatus;
    this.available = false;
    this.initError = null;
    this.packageRoot = null;
    this.version = null;
    this.nodeVersion = null;
    this.worker = null;
    this.pending = new Map();
    this.tools = new Map();
    this.skills = new Map();
    this.activeToolNames = new Set();
  }

  status(level, message, detail = null) {
    if (typeof this.onStatus === 'function') this.onStatus(level, message, detail);
  }

  resolvedFsRoot() {
    return path.resolve(expandHome(this.getFsRoot() || '~/'));
  }

  resolveToolPathWithinRoot(targetPath) {
    const root = fs.realpathSync(this.resolvedFsRoot());
    const raw = String(targetPath || '').trim();
    if (!raw) throw new Error('Tool path is required.');

    const resolved = path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(root, raw);

    if (!isWithin(root, resolved)) {
      throw new Error('Access denied: Pi tool path is outside the configured Aura filesystem root.');
    }

    if (fs.existsSync(resolved)) {
      const realTarget = fs.realpathSync(resolved);
      if (!isWithin(root, realTarget)) {
        throw new Error('Access denied: Pi tool path resolves outside the configured Aura filesystem root.');
      }
    }

    return resolved;
  }

  validateToolAuthority(name, args) {
    if (name === 'read' || name === 'edit' || name === 'write') {
      this.resolveToolPathWithinRoot(args?.path);
      return;
    }
    if ((name === 'grep' || name === 'find' || name === 'ls') && args?.path) {
      this.resolveToolPathWithinRoot(args.path);
      return;
    }
    if (name === 'bash' || name === 'powershell') {
      const command = String(args?.command || '').trim();
      const baseCmd = command.split(/\s+/)[0];
      const policy = this.getShellPolicy() || 'unrestricted';
      const allowlist = Array.isArray(this.getShellAllowlist()) ? this.getShellAllowlist() : [];
      const denylist = Array.isArray(this.getShellDenylist()) ? this.getShellDenylist() : [];
      if (policy === 'denylist' && denylist.includes(baseCmd)) {
        throw new Error(`Command '${baseCmd}' is explicitly blocked by Aura's denylist.`);
      }
      if (policy === 'allowlist' && !allowlist.includes(baseCmd)) {
        throw new Error(`Command '${baseCmd}' is not in Aura's shell allowlist.`);
      }
    }
  }

  _rejectPending(error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    for (const pending of this.pending.values()) {
      try { pending.signal?.removeEventListener('abort', pending.abortHandler); } catch {}
      pending.reject(failure);
    }
    this.pending.clear();
  }

  _handleWorkerMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'status') {
      this.status(message.level || 'info', message.message || 'Pi worker status', message.detail || null);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    if (message.type === 'update') {
      if (typeof pending.onUpdate === 'function') pending.onUpdate(message.update);
      return;
    }
    if (message.type !== 'response') return;
    this.pending.delete(message.id);
    try { pending.signal?.removeEventListener('abort', pending.abortHandler); } catch {}
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error || 'Pi worker request failed.'));
  }

  _request(method, params = {}, { signal, onUpdate } = {}) {
    if (!this.worker || !this.worker.connected) {
      return Promise.reject(new Error('Pi worker is not running.'));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        this.pending.delete(id);
        try { this.worker?.send({ type: 'cancel', id }); } catch {}
        reject(new Error(`Pi tool request '${method}' was aborted.`));
      };
      if (signal?.aborted) {
        abortHandler();
        return;
      }
      if (signal) signal.addEventListener('abort', abortHandler, { once: true });
      this.pending.set(id, { resolve, reject, onUpdate, signal, abortHandler });
      try {
        this.worker.send({ type: 'request', id, method, params });
      } catch (error) {
        this.pending.delete(id);
        if (signal) signal.removeEventListener('abort', abortHandler);
        reject(error);
      }
    });
  }

  async initialize() {
    if (this.available || this.worker) return this;

    try {
      const location = locatePiPackage();
      if (!location) throw new Error('Pi Coding Agent installation was not found.');
      if (!location.nodePath) {
        throw new Error('Pi requires Node >=22.19.0, but Aura could not locate a compatible external Node runtime.');
      }

      this.packageRoot = location.root;
      this.version = location.manifest.version || 'unknown';
      this.nodeVersion = location.nodeVersion || null;
      const cwd = this.resolvedFsRoot();
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        throw new Error(`Aura filesystem root is not an existing directory: ${cwd}`);
      }

      const workerPath = __dirname.includes(`${path.sep}app.asar${path.sep}`)
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'pi-worker.cjs')
        : path.join(__dirname, 'pi-worker.cjs');
      if (!fs.existsSync(workerPath)) {
        throw new Error(`Pi worker script not found: ${workerPath}`);
      }
      this.worker = fork(workerPath, [], {
        execPath: location.nodePath,
        cwd,
        env: { ...process.env },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc']
      });
      this.worker.on('message', message => this._handleWorkerMessage(message));
      this.worker.stderr?.on('data', chunk => {
        const text = String(chunk || '').trim();
        if (text) this.status('warn', 'Pi worker stderr', { text: text.slice(0, 2000) });
      });
      this.worker.on('error', error => {
        this._rejectPending(error);
        this.status('warn', 'Pi worker error.', { error: error.message });
      });
      this.worker.on('exit', (code, signal) => {
        const wasActive = this.available;
        this._rejectPending(new Error(`Pi worker exited (${signal || code || 'unknown'}).`));
        this.worker = null;
        this.available = false;
        if (wasActive && code !== 0) {
          this.status('warn', 'Pi worker exited unexpectedly.', { code, signal });
        }
      });

      const result = await this._request('initialize', {
        packageEntry: packageImportEntry(location),
        cwd
      });

      for (const info of result?.tools || []) {
        if (AURA_OWNED_TOOLS.has(info.name)) continue;
        this.tools.set(info.name, {
          name: info.name,
          description: info.description || '',
          parameters: info.parameters || { type: 'object', properties: {} },
          sourceInfo: info.sourceInfo,
          category: classifyTool(info.name),
          usesPiDefaultModel: PI_DEFAULT_MODEL_TOOLS.has(info.name)
        });
      }

      for (const skill of result?.skills || []) {
        if (!skill?.name || !skill?.filePath || !skill?.baseDir) continue;
        this.skills.set(skill.name, {
          name: skill.name,
          description: skill.description || '',
          filePath: fs.realpathSync(skill.filePath),
          baseDir: fs.realpathSync(skill.baseDir),
          sourceInfo: skill.sourceInfo,
          disableModelInvocation: skill.disableModelInvocation === true
        });
      }

      this.activeToolNames.clear();
      this.available = true;
      this.status('info', `Pi bridge ready (${this.tools.size} tools, ${this.skills.size} skills).`, {
        version: this.version,
        packageRoot: this.packageRoot,
        cwd,
        externalNode: location.nodePath,
        nodeVersion: this.nodeVersion
      });
      return this;
    } catch (error) {
      this.initError = error instanceof Error ? error : new Error(String(error));
      this.available = false;
      this.status('warn', 'Pi bridge unavailable.', { error: this.initError.message });
      this.dispose();
      return this;
    }
  }

  listTools() {
    return Array.from(this.tools.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  listSkills() {
    return Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  catalogText({ maxDescription = 150, toolNames = null, includeSkills = true } = {}) {
    if (!this.available) {
      return `Pi bridge unavailable: ${this.initError?.message || 'Pi is not installed.'}`;
    }

    const allowedToolNames = Array.isArray(toolNames) ? new Set(toolNames) : null;
    const toolLines = this.listTools().filter(tool => !allowedToolNames || allowedToolNames.has(tool.name)).map(tool => {
      const flags = [tool.category];
      if (tool.usesPiDefaultModel) flags.push(this.getAllowPiModelTools() ? 'model-enabled' : 'blocked-by-default');
      return `- tool ${tool.name} [${flags.join(', ')}]: ${oneLine(tool.description, maxDescription) || 'No description provided.'}`;
    });
    const skillLines = includeSkills ? this.listSkills().map(skill =>
      `- skill ${skill.name}: ${oneLine(skill.description, maxDescription) || 'No description provided.'}`
    ) : [];

    return [
      `Pi ${this.version} capabilities. Only tools selected in Aura Settings are exposed and enabled for the current MCP session.`,
      'Aura executes Pi tools in Pi\'s compatible external Node runtime; it never calls Pi session.prompt(), so registry/Skill use does not spend Pi default-model tokens.',
      ...toolLines,
      ...skillLines
    ].join('\n');
  }

  async enableTools(requestedNames = [], allowedNames = null) {
    const result = { enabled: [], alreadyActive: [], blocked: [], unknown: [] };
    if (!this.available || !this.worker) {
      for (const name of requestedNames) result.unknown.push(String(name));
      return result;
    }

    const allowed = Array.isArray(allowedNames) ? new Set(allowedNames) : null;
    const nextActive = new Set(this.activeToolNames);
    for (const rawName of requestedNames) {
      const name = String(rawName || '').trim();
      if (!name || !this.tools.has(name)) {
        result.unknown.push(name || String(rawName));
        continue;
      }
      if (allowed && !allowed.has(name)) {
        result.blocked.push({ name, reason: 'Not enabled in Aura Pi tool settings.' });
        continue;
      }
      const tool = this.tools.get(name);
      if (tool.usesPiDefaultModel && !this.getAllowPiModelTools()) {
        result.blocked.push({ name, reason: 'May invoke the Pi default model; Aura piAllowModelTools is disabled.' });
        continue;
      }
      if (nextActive.has(name)) {
        result.alreadyActive.push(name);
        continue;
      }
      nextActive.add(name);
      result.enabled.push(name);
    }

    if (result.enabled.length > 0) {
      await this._request('setActiveTools', { names: Array.from(nextActive) });
      this.activeToolNames = nextActive;
    }
    return result;
  }

  readSkill(skillName, relativePath = 'SKILL.md') {
    const skill = this.skills.get(String(skillName || '').trim());
    if (!skill) throw new Error(`Unknown Pi skill '${skillName}'. Call list_skills to inspect available skills.`);

    const requestedPath = String(relativePath || 'SKILL.md').trim() || 'SKILL.md';
    if (path.isAbsolute(requestedPath)) throw new Error('Skill file path must be relative to the Skill directory.');

    const target = path.resolve(skill.baseDir, requestedPath);
    if (!isWithin(skill.baseDir, target)) throw new Error('Access denied: Skill path escapes the Skill directory.');
    if (!fs.existsSync(target)) throw new Error(`Skill file not found: ${requestedPath}`);

    const realTarget = fs.realpathSync(target);
    if (!isWithin(skill.baseDir, realTarget)) throw new Error('Access denied: Skill file resolves outside the Skill directory.');

    const stat = fs.statSync(realTarget);
    if (!stat.isFile()) throw new Error(`Skill path is not a file: ${requestedPath}`);
    if (stat.size > MAX_SKILL_FILE_BYTES) {
      throw new Error(`Skill file is too large (${stat.size} bytes; max ${MAX_SKILL_FILE_BYTES}).`);
    }

    return {
      skill,
      requestedPath,
      absolutePath: realTarget,
      bytes: stat.size,
      content: fs.readFileSync(realTarget, 'utf8')
    };
  }

  activateSkills(requestedNames = []) {
    const activated = [];
    const unknown = [];
    let totalBytes = 0;

    for (const rawName of requestedNames) {
      const name = String(rawName || '').trim();
      if (!name || !this.skills.has(name)) {
        unknown.push(name || String(rawName));
        continue;
      }
      const loaded = this.readSkill(name, 'SKILL.md');
      if (totalBytes + loaded.bytes > MAX_ACTIVATED_SKILL_BYTES) {
        activated.push({
          name,
          skipped: true,
          reason: `Activation payload limit (${MAX_ACTIVATED_SKILL_BYTES} bytes) reached; call read_skill('${name}') separately.`
        });
        continue;
      }
      totalBytes += loaded.bytes;
      activated.push({
        name,
        bytes: loaded.bytes,
        content: `<skill name="${loaded.skill.name}" location="${loaded.skill.filePath}">\nReferences are relative to ${loaded.skill.baseDir}.\n\n${loaded.content}\n</skill>`
      });
    }

    return { activated, unknown, totalBytes };
  }

  async executeTool(name, args = {}, { signal, onUpdate } = {}) {
    if (!this.available || !this.worker) throw new Error('Pi bridge is unavailable.');
    if (!this.activeToolNames.has(name)) {
      throw new Error(`Capability '${name}' is not enabled in Aura Settings.`);
    }

    this.validateToolAuthority(name, args);
    return this._request('execute', { name, args }, { signal, onUpdate });
  }

  dispose() {
    const worker = this.worker;
    this.worker = null;
    this.available = false;
    this._rejectPending(new Error('Pi bridge disposed.'));
    if (worker) {
      try {
        if (worker.connected) worker.send({ type: 'request', id: randomUUID(), method: 'shutdown', params: {} });
      } catch {}
      const timer = setTimeout(() => {
        try { if (!worker.killed) worker.kill(); } catch {}
      }, 750);
      timer.unref?.();
    }
    this.tools.clear();
    this.skills.clear();
    this.activeToolNames.clear();
  }
}
module.exports = {
  PiBridge,
  jsonSchemaToZod,
  locatePiPackage,
  PI_DEFAULT_MODEL_TOOLS
};
