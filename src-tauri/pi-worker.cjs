const { pathToFileURL } = require('url');
const { randomUUID } = require('crypto');
const readline = require('readline');

let session = null;
const inFlight = new Map();

function clone(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function toolResultText(result) {
  if (!result || !Array.isArray(result.content)) return '';
  return result.content
    .map(item => item?.type === 'text' ? item.text : `[${item?.type || 'content'}]`)
    .join('\n')
    .trim();
}

function sendMessage(message) {
  if (process.send && process.connected) {
    process.send(message);
    return;
  }
  process.stdout.write(`AURA_IPC:${JSON.stringify(message)}\n`);
}

function sendResponse(id, ok, result, error) {
  sendMessage({ type: 'response', id, ok, result: clone(result), error });
}

async function initialize(params) {
  if (session) return { tools: [], skills: [] };
  const sdk = await import(pathToFileURL(params.packageEntry).href);
  const sessionManager = sdk.SessionManager?.inMemory
    ? sdk.SessionManager.inMemory(params.cwd)
    : undefined;
  const created = await sdk.createAgentSession({ cwd: params.cwd, sessionManager });
  session = created.session;

  if (typeof session.extendResourcesFromExtensions === 'function') {
    try {
      await session.extendResourcesFromExtensions('startup');
    } catch (error) {
      sendMessage({ type: 'status', level: 'warn', message: 'Pi extension skill discovery was partial.', detail: { error: error.message } });
    }
  }

  const tools = [];
  for (const info of session.getAllTools()) {
    const definition = session.getToolDefinition(info.name);
    if (!definition) continue;
    tools.push({
      name: info.name,
      description: info.description || definition.description || '',
      parameters: clone(definition.parameters) || { type: 'object', properties: {} },
      sourceInfo: clone(info.sourceInfo)
    });
  }

  const skills = session.resourceLoader.getSkills().skills.map(skill => ({
    name: skill.name,
    description: skill.description || '',
    filePath: skill.filePath,
    baseDir: skill.baseDir,
    sourceInfo: clone(skill.sourceInfo),
    disableModelInvocation: skill.disableModelInvocation === true
  }));

  session.setActiveToolsByName([]);
  return { tools, skills };
}

async function handleRequest(message) {
  const { id, method, params = {} } = message;
  try {
    if (method === 'initialize') {
      sendResponse(id, true, await initialize(params));
      return;
    }
    if (!session) throw new Error('Pi worker is not initialized.');

    if (method === 'setActiveTools') {
      session.setActiveToolsByName(Array.isArray(params.names) ? params.names : []);
      sendResponse(id, true, { active: session.getActiveToolNames() });
      return;
    }

    if (method === 'execute') {
      const tool = session.state.tools.find(candidate => candidate.name === params.name);
      if (!tool) throw new Error(`Pi tool '${params.name}' is not present in the active Pi tool set.`);
      const controller = new AbortController();
      inFlight.set(id, controller);
      try {
        const result = await tool.execute(
          randomUUID(),
          params.args || {},
          controller.signal,
          update => sendMessage({ type: 'update', id, update: clone(update) })
        );
        sendResponse(id, true, {
          content: Array.isArray(result?.content) ? clone(result.content) : [{ type: 'text', text: String(result ?? '') }],
          isError: result?.isError === true,
          logText: toolResultText(result)
        });
      } finally {
        inFlight.delete(id);
      }
      return;
    }

    if (method === 'shutdown') {
      try { session?.dispose(); } catch {}
      session = null;
      sendResponse(id, true, { ok: true });
      setImmediate(() => process.exit(0));
      return;
    }

    throw new Error(`Unknown Pi worker method: ${method}`);
  } catch (error) {
    inFlight.delete(id);
    sendResponse(id, false, null, error instanceof Error ? error.message : String(error));
  }
}

function receiveMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'cancel') {
    inFlight.get(message.id)?.abort();
    return;
  }
  if (message.type === 'request') {
    handleRequest(message);
  }
}

if (process.send) {
  process.on('message', receiveMessage);
  process.on('disconnect', () => {
    try { session?.dispose(); } catch {}
    process.exit(0);
  });
} else {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', line => {
    try { receiveMessage(JSON.parse(line)); } catch {}
  });
  input.on('close', () => {
    try { session?.dispose(); } catch {}
    process.exit(0);
  });
}
