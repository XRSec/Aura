const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { randomUUID } = require('crypto');
const { z } = require('zod');

const MAX_SKILL_FILE_BYTES = 1024 * 1024;
const MAX_ACTIVATED_SKILL_BYTES = 512 * 1024;

// Aura already provides these capabilities itself. Re-exporting Pi's copies would
// create duplicate filesystem/shell authority and weaken Aura's existing policy boundary.
const AURA_OWNED_TOOLS = new Set([
  'read',
  'bash',
  'powershell',
  'write',
  'grep',
  'find',
  'ls',
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

function locatePiPackage() {
  for (const candidate of executableCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const stat = fs.statSync(candidate);
      const resolvedCandidate = stat.isDirectory() ? candidate : fs.realpathSync(candidate);
      const found = findPackageRoot(resolvedCandidate);
      if (found) return found;
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
        if (found) return found;
      } catch {
        // Continue.
      }
    }
  }

  return null;
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
  constructor({ getFsRoot = () => '~/', getAllowPiModelTools = () => false, onStatus = null } = {}) {
    this.getFsRoot = getFsRoot;
    this.getAllowPiModelTools = getAllowPiModelTools;
    this.onStatus = onStatus;
    this.available = false;
    this.initError = null;
    this.packageRoot = null;
    this.version = null;
    this.session = null;
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
    if (name === 'edit') {
      this.resolveToolPathWithinRoot(args?.path);
    }
  }

  async initialize() {
    if (this.available || this.session) return this;

    try {
      const location = locatePiPackage();
      if (!location) throw new Error('Pi Coding Agent installation was not found.');

      this.packageRoot = location.root;
      this.version = location.manifest.version || 'unknown';
      const sdk = await import(pathToFileURL(packageImportEntry(location)).href);
      const cwd = this.resolvedFsRoot();
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        throw new Error(`Aura filesystem root is not an existing directory: ${cwd}`);
      }

      const sessionManager = sdk.SessionManager?.inMemory
        ? sdk.SessionManager.inMemory(cwd)
        : undefined;
      const created = await sdk.createAgentSession({ cwd, sessionManager });
      this.session = created.session;

      // Resource-discovery hooks add package/extension skills without starting an LLM turn.
      if (typeof this.session.extendResourcesFromExtensions === 'function') {
        try {
          await this.session.extendResourcesFromExtensions('startup');
        } catch (error) {
          this.status('warn', 'Pi extension skill discovery was partial.', { error: error.message });
        }
      }

      for (const info of this.session.getAllTools()) {
        if (AURA_OWNED_TOOLS.has(info.name)) continue;
        const definition = this.session.getToolDefinition(info.name);
        if (!definition) continue;
        this.tools.set(info.name, {
          name: info.name,
          description: info.description || definition.description || '',
          parameters: definition.parameters || { type: 'object', properties: {} },
          sourceInfo: info.sourceInfo,
          category: classifyTool(info.name),
          usesPiDefaultModel: PI_DEFAULT_MODEL_TOOLS.has(info.name)
        });
      }

      for (const skill of this.session.resourceLoader.getSkills().skills) {
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

      // The bridge only uses Pi as a registry/executor. Clearing the AgentSession's
      // active tools prevents accidental agent-loop use and does not call a model.
      this.session.setActiveToolsByName([]);
      this.activeToolNames.clear();
      this.available = true;
      this.status('info', `Pi bridge ready (${this.tools.size} tools, ${this.skills.size} skills).`, {
        version: this.version,
        packageRoot: this.packageRoot,
        cwd
      });
      return this;
    } catch (error) {
      this.initError = error instanceof Error ? error : new Error(String(error));
      this.available = false;
      this.status('warn', 'Pi bridge unavailable.', { error: this.initError.message });
      try { this.session?.dispose(); } catch {}
      this.session = null;
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
      `Pi ${this.version} capabilities. Tools are inactive until request_capabilities enables them.`,
      'Aura calls tool execute() directly; it never calls Pi session.prompt(), so registry/Skill use does not spend Pi default-model tokens.',
      ...toolLines,
      ...skillLines
    ].join('\n');
  }

  enableTools(requestedNames = [], allowedNames = null) {
    const result = { enabled: [], alreadyActive: [], blocked: [], unknown: [] };
    if (!this.available || !this.session) {
      for (const name of requestedNames) result.unknown.push(String(name));
      return result;
    }

    const allowed = Array.isArray(allowedNames) ? new Set(allowedNames) : null;
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
      if (this.activeToolNames.has(name)) {
        result.alreadyActive.push(name);
        continue;
      }
      this.activeToolNames.add(name);
      result.enabled.push(name);
    }

    this.session.setActiveToolsByName(Array.from(this.activeToolNames));
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
    if (!this.available || !this.session) throw new Error('Pi bridge is unavailable.');
    if (!this.activeToolNames.has(name)) throw new Error(`Pi tool '${name}' is not active. Call request_capabilities first.`);

    const tool = this.session.state.tools.find(candidate => candidate.name === name);
    if (!tool) throw new Error(`Pi tool '${name}' is not present in the active Pi tool set.`);

    this.validateToolAuthority(name, args);
    const result = await tool.execute(randomUUID(), args, signal, onUpdate);
    return {
      content: Array.isArray(result?.content) ? result.content : [{ type: 'text', text: String(result ?? '') }],
      isError: result?.isError === true,
      logText: toolResultText(result)
    };
  }

  dispose() {
    try { this.session?.dispose(); } catch {}
    this.session = null;
    this.available = false;
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
