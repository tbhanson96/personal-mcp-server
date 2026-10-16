import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { lstat, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import nacl from 'tweetnacl';

type JsonObject = Record<string, unknown>;

type DaemonState = {
  pid?: number;
  httpPort?: number;
};

type TrackedSession = {
  startedBy: string;
  happySessionId: string;
  pid: number;
};

type PersistedSession = {
  encryptionKey: string;
  encryptionVariant: 'legacy' | 'dataKey';
  seq: number;
  metadataVersion: number;
  agentStateVersion: number;
  metadata: JsonObject;
  savedAt: number;
};

export type HappyBridgeOptions = {
  socketPath: string;
  happyHome: string;
  allowedRoots: string[];
  serverUrl: string;
  supportedVersion: string;
  maxPromptChars: number;
};

const permissionModes = new Set(['auto', 'read-only', 'safe-yolo', 'yolo']);
const effortLevels = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const sessionIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const modelPattern = /^[A-Za-z0-9._:/-]{1,128}$/;

export function loadHappyBridgeOptions(env: NodeJS.ProcessEnv = process.env): HappyBridgeOptions {
  const uid = process.getuid?.() ?? 1000;
  const happyHome = resolve(expandHome(env.HAPPY_HOME_DIR || '~/.happy'));
  const allowedRoots = (env.HAPPY_BRIDGE_ALLOWED_ROOTS || '~/Repo')
    .split(':')
    .filter(Boolean)
    .map((entry) => resolve(expandHome(entry)));

  return {
    socketPath: env.HAPPY_BRIDGE_SOCKET || `/run/user/${uid}/happy-mcp-bridge/bridge.sock`,
    happyHome,
    allowedRoots,
    serverUrl: (env.HAPPY_SERVER_URL || readServerUrlFallback(happyHome) || 'https://api.cluster-fluster.com').replace(/\/+$/, ''),
    supportedVersion: env.HAPPY_BRIDGE_SUPPORTED_VERSION || '1.2.4',
    maxPromptChars: positiveInt(env.HAPPY_BRIDGE_MAX_PROMPT_CHARS, 100_000),
  };
}

function expandHome(value: string): string {
  return value === '~' ? homedir() : value.startsWith('~/') ? resolve(homedir(), value.slice(2)) : value;
}

function readServerUrlFallback(_happyHome: string): undefined {
  // Settings are read asynchronously for requests. The stable hosted URL remains
  // the startup fallback; HAPPY_SERVER_URL overrides self-hosted installations.
  return undefined;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, got ${raw}`);
  return parsed;
}

export async function assertAllowedDirectory(directory: string, allowedRoots: string[]): Promise<string> {
  if (!directory || !isAbsolute(directory)) throw new BridgeError(400, 'directory must be an absolute path');
  const target = await realpath(directory).catch(() => {
    throw new BridgeError(400, 'directory must already exist');
  });
  const targetStat = await stat(target);
  if (!targetStat.isDirectory()) throw new BridgeError(400, 'directory must refer to a directory');

  const roots = await Promise.all(allowedRoots.map(async (root) => realpath(root).catch(() => resolve(root))));
  const allowed = roots.some((root) => {
    const child = relative(root, target);
    return child === '' || (!child.startsWith('..') && !isAbsolute(child));
  });
  if (!allowed) throw new BridgeError(403, 'directory is outside HAPPY_BRIDGE_ALLOWED_ROOTS');
  return target;
}

export function encryptHappyMessage(
  message: JsonObject,
  key: Uint8Array,
  variant: 'legacy' | 'dataKey',
  nonce?: Uint8Array,
): Uint8Array {
  const plaintext = Buffer.from(JSON.stringify(message), 'utf8');
  if (key.length !== 32) throw new Error('Happy session encryption key must be 32 bytes');

  if (variant === 'legacy') {
    const actualNonce = nonce ?? randomBytes(nacl.secretbox.nonceLength);
    if (actualNonce.length !== nacl.secretbox.nonceLength) throw new Error('Legacy nonce must be 24 bytes');
    const ciphertext = nacl.secretbox(plaintext, actualNonce, key);
    return Buffer.concat([Buffer.from(actualNonce), Buffer.from(ciphertext)]);
  }

  const actualNonce = nonce ?? randomBytes(12);
  if (actualNonce.length !== 12) throw new Error('Data-key nonce must be 12 bytes');
  const cipher = createCipheriv('aes-256-gcm', key, actualNonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([0]), Buffer.from(actualNonce), ciphertext, cipher.getAuthTag()]);
}

export class HappyBridge {
  constructor(private readonly options: HappyBridgeOptions) {}

  async handle(path: string, body: JsonObject): Promise<unknown> {
    switch (path) {
      case '/status':
        return this.status();
      case '/sessions/list':
        return { sessions: await this.listSessions() };
      case '/sessions/start':
        return this.startSession(body);
      case '/sessions/prompt':
        return this.sendPrompt(body);
      case '/sessions/start-and-prompt': {
        const started = await this.startSession(body);
        const prompted = await this.sendPrompt({ ...body, session_id: started.sessionId });
        return { ...started, prompt: prompted };
      }
      case '/sessions/stop':
        return this.stopSession(body);
      default:
        throw new BridgeError(404, 'Unknown Happy bridge operation');
    }
  }

  private async status(): Promise<unknown> {
    const status = await this.daemonPost('/status', {});
    const cliVersion = stringValue(status.cliVersion, 'daemon cliVersion');
    return {
      running: true,
      connected: Boolean(status.connected),
      cliVersion,
      compatible: cliVersion === this.options.supportedVersion,
      supportedVersion: this.options.supportedVersion,
    };
  }

  private async requireCompatibleDaemon(): Promise<void> {
    const status = await this.status() as { cliVersion: string; compatible: boolean };
    if (!status.compatible) {
      throw new BridgeError(409, `Happy CLI ${status.cliVersion} is not supported; expected ${this.options.supportedVersion}`);
    }
  }

  private async listSessions(): Promise<TrackedSession[]> {
    const result = await this.daemonPost('/list', {});
    if (!Array.isArray(result.children)) throw new BridgeError(502, 'Happy daemon returned an invalid session list');
    return result.children.map((item) => {
      const record = objectValue(item, 'session');
      return {
        startedBy: stringValue(record.startedBy, 'startedBy'),
        happySessionId: sessionId(record.happySessionId),
        pid: numberValue(record.pid, 'pid'),
      };
    });
  }

  private async startSession(body: JsonObject): Promise<{ success: true; sessionId: string }> {
    await this.requireCompatibleDaemon();
    const directory = await assertAllowedDirectory(stringValue(body.directory, 'directory'), this.options.allowedRoots);
    const permissionMode = optionalEnum(body.permission_mode, permissionModes, 'permission_mode') ?? 'auto';
    const model = optionalString(body.model, 'model');
    if (model && !modelPattern.test(model)) throw new BridgeError(400, 'model contains unsupported characters');
    const effort = optionalEnum(body.effort, effortLevels, 'effort');

    const result = await this.daemonPost('/spawn-session', {
      directory,
      agent: 'codex',
      permissionMode,
      ...(model ? { modelMode: model } : {}),
      ...(effort ? { effortLevel: effort } : {}),
    });
    if (result.success !== true) throw new BridgeError(502, optionalString(result.error, 'error') || 'Happy daemon failed to start a session');
    return { success: true, sessionId: sessionId(result.sessionId) };
  }

  private async sendPrompt(body: JsonObject): Promise<{ accepted: true; sessionId: string; localId: string }> {
    await this.requireCompatibleDaemon();
    const id = sessionId(body.session_id);
    const prompt = stringValue(body.prompt, 'prompt');
    if (prompt.length > this.options.maxPromptChars) throw new BridgeError(400, `prompt exceeds ${this.options.maxPromptChars} characters`);

    const active = await this.listSessions();
    if (!active.some((session) => session.happySessionId === id)) {
      throw new BridgeError(404, 'session is not active and tracked by this daemon');
    }

    const permissionMode = optionalEnum(body.permission_mode, permissionModes, 'permission_mode');
    const model = optionalString(body.model, 'model');
    if (model && !modelPattern.test(model)) throw new BridgeError(400, 'model contains unsupported characters');
    const effort = optionalEnum(body.effort, effortLevels, 'effort');
    const session = await this.persistedSession(id);
    const token = await this.accessToken();
    const localId = randomUUID();
    const message = {
      role: 'user',
      content: { type: 'text', text: prompt },
      localKey: randomUUID(),
      meta: {
        sentFrom: 'personal-mcp',
        ...(permissionMode ? { permissionMode } : {}),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
      },
    };
    const encrypted = encryptHappyMessage(message, Buffer.from(session.encryptionKey, 'base64'), session.encryptionVariant);
    const response = await fetch(`${await this.serverUrl()}/v3/sessions/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-happy-client': `personal-mcp-happy-bridge/${this.options.supportedVersion}`,
      },
      body: JSON.stringify({ messages: [{ content: Buffer.from(encrypted).toString('base64'), localId }] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new BridgeError(502, `Happy rejected the prompt (HTTP ${response.status})`);
    return { accepted: true, sessionId: id, localId };
  }

  private async stopSession(body: JsonObject): Promise<{ success: boolean; sessionId: string }> {
    await this.requireCompatibleDaemon();
    const id = sessionId(body.session_id);
    const active = await this.listSessions();
    if (!active.some((session) => session.happySessionId === id)) {
      throw new BridgeError(404, 'session is not active and tracked by this daemon');
    }
    const result = await this.daemonPost('/stop-session', { sessionId: id });
    return { success: result.success === true, sessionId: id };
  }

  private async daemonPost(path: string, body: JsonObject): Promise<JsonObject> {
    const state = await this.daemonState();
    const response = await fetch(`http://127.0.0.1:${state.httpPort}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    }).catch((error: unknown) => {
      throw new BridgeError(502, `Could not reach Happy daemon: ${error instanceof Error ? error.message : String(error)}`);
    });
    const parsed = await response.json().catch(() => {
      throw new BridgeError(502, 'Happy daemon returned invalid JSON');
    });
    if (!response.ok) {
      const record = objectValue(parsed, 'daemon error');
      throw new BridgeError(response.status, optionalString(record.error, 'error') || `Happy daemon returned HTTP ${response.status}`);
    }
    return objectValue(parsed, 'daemon response');
  }

  private async daemonState(): Promise<Required<DaemonState>> {
    const state = await readJson(resolve(this.options.happyHome, 'daemon.state.json')) as DaemonState;
    if (!Number.isSafeInteger(state.pid) || !Number.isSafeInteger(state.httpPort)) {
      throw new BridgeError(503, 'Happy daemon state is missing or invalid');
    }
    try {
      process.kill(state.pid!, 0);
    } catch {
      throw new BridgeError(503, 'Happy daemon is not running');
    }
    return { pid: state.pid!, httpPort: state.httpPort! };
  }

  private async persistedSession(id: string): Promise<PersistedSession> {
    const registry = objectValue(await readJson(resolve(this.options.happyHome, 'sessions.json')), 'sessions registry');
    const sessions = objectValue(registry.sessions, 'sessions');
    const record = objectValue(sessions[id], 'persisted session');
    const variant = stringValue(record.encryptionVariant, 'encryptionVariant');
    if (variant !== 'legacy' && variant !== 'dataKey') throw new BridgeError(409, 'unsupported Happy session encryption variant');
    return {
      encryptionKey: stringValue(record.encryptionKey, 'encryptionKey'),
      encryptionVariant: variant,
      seq: numberValue(record.seq, 'seq'),
      metadataVersion: numberValue(record.metadataVersion, 'metadataVersion'),
      agentStateVersion: numberValue(record.agentStateVersion, 'agentStateVersion'),
      metadata: objectValue(record.metadata, 'metadata'),
      savedAt: numberValue(record.savedAt, 'savedAt'),
    };
  }

  private async accessToken(): Promise<string> {
    const credentials = objectValue(await readJson(resolve(this.options.happyHome, 'access.key')), 'Happy credentials');
    return stringValue(credentials.token, 'Happy access token');
  }

  private async serverUrl(): Promise<string> {
    const settings = objectValue(await readJson(resolve(this.options.happyHome, 'settings.json')), 'Happy settings');
    const configured = optionalString(settings.serverUrl, 'serverUrl');
    return (process.env.HAPPY_SERVER_URL || configured || this.options.serverUrl).replace(/\/+$/, '');
  }
}

class BridgeError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new BridgeError(503, `Could not read required Happy state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function objectValue(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BridgeError(502, `${name} must be an object`);
  return value as JsonObject;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new BridgeError(400, `${name} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return stringValue(value, name);
}

function numberValue(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new BridgeError(502, `${name} must be an integer`);
  return value;
}

function optionalEnum(value: unknown, allowed: Set<string>, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = stringValue(value, name);
  if (!allowed.has(parsed)) throw new BridgeError(400, `${name} is not supported`);
  return parsed;
}

function sessionId(value: unknown): string {
  const parsed = stringValue(value, 'session_id');
  if (!sessionIdPattern.test(parsed)) throw new BridgeError(400, 'session_id has an invalid format');
  return parsed;
}

async function parseBody(request: IncomingMessage, maxBytes: number): Promise<JsonObject> {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) throw new BridgeError(413, 'request body is too large');
  }
  if (!raw) return {};
  try {
    return objectValue(JSON.parse(raw), 'request body');
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError(400, 'request body must be valid JSON');
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

export async function startHappyBridge(options = loadHappyBridgeOptions()): Promise<void> {
  if (!isAbsolute(options.socketPath)) throw new Error('HAPPY_BRIDGE_SOCKET must be absolute');
  await mkdir(dirname(options.socketPath), { recursive: true, mode: 0o700 });
  try {
    const existing = await lstat(options.socketPath);
    if (!existing.isSocket()) throw new Error(`Refusing to replace non-socket path: ${options.socketPath}`);
    await rm(options.socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const bridge = new HappyBridge(options);
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || !request.url) throw new BridgeError(405, 'Only POST is supported');
      const body = await parseBody(request, options.maxPromptChars * 4 + 16_384);
      sendJson(response, 200, await bridge.handle(new URL(request.url, 'http://localhost').pathname, body));
    } catch (error) {
      const statusCode = error instanceof BridgeError ? error.statusCode : 500;
      const message = error instanceof Error ? error.message : 'Unknown bridge error';
      sendJson(response, statusCode, { error: message });
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options.socketPath, resolveListen);
  });
  await import('node:fs/promises').then(({ chmod }) => chmod(options.socketPath, 0o600));
  console.log(JSON.stringify({ event: 'happy.bridge.started', socketPath: options.socketPath }));

  const shutdown = () => {
    server.close(() => {
      void rm(options.socketPath, { force: true }).finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHappyBridge().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
