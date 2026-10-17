import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
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

type MessageDetail = 'summary' | 'full';

type NormalizedMessage = {
  id: string;
  seq: number;
  local_id?: string;
  created_at: number;
  updated_at: number;
  role: string;
  kind: string;
  text?: string;
  provider?: string;
  sent_from?: string;
  content?: unknown;
  content_preview?: string;
  truncated: boolean;
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
const messageDetails = new Set(['summary', 'full']);
const summaryKinds = new Set(['message', 'error', 'status', 'completion']);
const maxBridgeResponseBytes = 750_000;

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
  const allowedRootsText = allowedRoots.join(', ');
  if (!directory || !isAbsolute(directory)) {
    throw new BridgeError(400, `directory must be an absolute host path under an allowed root: ${allowedRootsText}`);
  }
  const target = await realpath(directory).catch(() => {
    throw new BridgeError(400, `directory must already exist on the host under an allowed root: ${allowedRootsText}`);
  });
  const targetStat = await stat(target);
  if (!targetStat.isDirectory()) throw new BridgeError(400, 'directory must refer to a directory');

  const roots = await Promise.all(allowedRoots.map(async (root) => realpath(root).catch(() => resolve(root))));
  const allowed = roots.some((root) => {
    const child = relative(root, target);
    return child === '' || (!child.startsWith('..') && !isAbsolute(child));
  });
  if (!allowed) throw new BridgeError(403, `directory is outside the allowed host roots: ${roots.join(', ')}`);
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

export function decryptHappyMessage(
  encrypted: Uint8Array,
  key: Uint8Array,
  variant: 'legacy' | 'dataKey',
): JsonObject {
  if (key.length !== 32) throw new Error('Happy session encryption key must be 32 bytes');
  let plaintext: Uint8Array | null = null;

  if (variant === 'legacy') {
    if (encrypted.length < nacl.secretbox.nonceLength + nacl.secretbox.overheadLength) {
      throw new Error('Legacy Happy message is too short');
    }
    plaintext = nacl.secretbox.open(
      encrypted.subarray(nacl.secretbox.nonceLength),
      encrypted.subarray(0, nacl.secretbox.nonceLength),
      key,
    );
  } else {
    if (encrypted.length < 29 || encrypted[0] !== 0) throw new Error('Data-key Happy message has an invalid envelope');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(1, 13));
      decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
      plaintext = Buffer.concat([
        decipher.update(encrypted.subarray(13, encrypted.length - 16)),
        decipher.final(),
      ]);
    } catch {
      plaintext = null;
    }
  }

  if (!plaintext) throw new Error('Happy message decryption failed');
  const parsed: unknown = JSON.parse(Buffer.from(plaintext).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Happy message body must be an object');
  return parsed as JsonObject;
}

export function normalizeHappyMessage(
  raw: JsonObject,
  decrypted: JsonObject,
  detail: MessageDetail,
  maxContentChars: number,
): NormalizedMessage | undefined {
  const role = typeof decrypted.role === 'string' ? decrypted.role : 'unknown';
  const content = isObject(decrypted.content) ? decrypted.content : undefined;
  const provider = content && typeof content.provider === 'string' ? content.provider : undefined;
  const subtype = content ? eventSubtype(content) : undefined;
  const kind = classifyMessage(role, content?.type, subtype);
  if (detail === 'summary' && role !== 'user' && !summaryKinds.has(kind)) return undefined;

  const textSource = content ? extractMessageText(content) : undefined;
  const textResult = truncateText(textSource, maxContentChars);
  const meta = isObject(decrypted.meta) ? decrypted.meta : undefined;
  const normalized: NormalizedMessage = {
    id: stringValue(raw.id, 'message id'),
    seq: nonNegativeInteger(raw.seq, 'message seq', 502),
    ...(typeof raw.localId === 'string' && raw.localId ? { local_id: raw.localId } : {}),
    created_at: nonNegativeInteger(raw.createdAt, 'message createdAt', 502),
    updated_at: nonNegativeInteger(raw.updatedAt, 'message updatedAt', 502),
    role,
    kind,
    ...(textResult.text ? { text: textResult.text } : {}),
    ...(provider ? { provider } : {}),
    ...(meta && typeof meta.sentFrom === 'string' ? { sent_from: meta.sentFrom } : {}),
    truncated: textResult.truncated,
  };

  if (detail === 'full' && content) {
    const serialized = JSON.stringify(content);
    if (serialized.length <= maxContentChars) {
      normalized.content = content;
    } else {
      normalized.content_preview = serialized.slice(0, maxContentChars);
      normalized.truncated = true;
    }
  }
  return normalized;
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
      case '/sessions/messages':
        return this.getMessages(body);
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
      allowed_roots: this.options.allowedRoots,
      directory_guidance: 'Use an absolute host filesystem path under allowed_roots. Paths returned by homeserver file tools may use a different filesystem namespace.',
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

  private async getMessages(body: JsonObject): Promise<unknown> {
    const id = sessionId(body.session_id);
    const requestedAfterSeq = optionalBoundedInteger(body.after_seq, 'after_seq', 0, Number.MAX_SAFE_INTEGER) ?? 0;
    const limit = optionalBoundedInteger(body.limit, 'limit', 1, 100) ?? 50;
    const waitSeconds = optionalBoundedInteger(body.wait_seconds, 'wait_seconds', 0, 20) ?? 0;
    const detail = (optionalEnum(body.detail, messageDetails, 'detail') ?? 'summary') as MessageDetail;
    const maxContentChars = optionalBoundedInteger(body.max_content_chars, 'max_content_chars', 1, 100_000) ?? 20_000;
    const session = await this.persistedSession(id);
    const key = Buffer.from(session.encryptionKey, 'base64');
    if (key.length !== 32) throw new BridgeError(409, 'Happy session encryption key is invalid');
    const token = await this.accessToken();
    const serverUrl = await this.serverUrl();
    const deadline = Date.now() + waitSeconds * 1_000;
    const startedAt = Date.now();
    const messages: NormalizedMessage[] = [];
    let cursor = requestedAfterSeq;
    let hasMore = false;
    let suppressedCount = 0;
    let decryptionFailures = 0;

    do {
      const page = await this.fetchMessagePage(serverUrl, token, id, cursor, limit);
      const rawMessages = page.messages;
      hasMore = page.hasMore;
      let stoppedForBudget = false;

      for (const value of rawMessages) {
        const raw = objectValue(value, 'Happy message');
        const seq = nonNegativeInteger(raw.seq, 'message seq', 502);
        if (seq <= cursor) continue;

        let normalized: NormalizedMessage | undefined;
        try {
          const envelope = objectValue(raw.content, 'message content');
          if (envelope.t !== 'encrypted') {
            suppressedCount += 1;
            cursor = seq;
            continue;
          }
          const ciphertext = Buffer.from(stringValue(envelope.c, 'encrypted message content'), 'base64');
          const decrypted = decryptHappyMessage(ciphertext, key, session.encryptionVariant);
          normalized = normalizeHappyMessage(raw, decrypted, detail, maxContentChars);
        } catch {
          decryptionFailures += 1;
          cursor = seq;
          continue;
        }

        if (!normalized) {
          suppressedCount += 1;
          cursor = seq;
          continue;
        }

        const projectedBytes = Buffer.byteLength(JSON.stringify([...messages, normalized]));
        if (projectedBytes > maxBridgeResponseBytes) {
          stoppedForBudget = true;
          hasMore = true;
          break;
        }
        messages.push(normalized);
        cursor = seq;
      }

      if (stoppedForBudget) break;
      if (waitSeconds === 0 && messages.length > 0) break;
      if (messages.some((message) => message.role === 'agent' && ['message', 'error', 'completion'].includes(message.kind))) break;
      if (hasMore && rawMessages.length > 0) continue;
      if (Date.now() >= deadline) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(750, deadline - Date.now())));
    } while (Date.now() <= deadline);

    if (decryptionFailures > 0 && messages.length === 0 && suppressedCount === 0) {
      throw new BridgeError(502, 'Happy messages could not be decrypted');
    }

    const active = await this.listSessions()
      .then((sessions) => sessions.some((tracked) => tracked.happySessionId === id))
      .catch(() => false);
    return {
      session_id: id,
      messages,
      next_after_seq: cursor,
      has_more: hasMore,
      active,
      waited_ms: Date.now() - startedAt,
      suppressed_count: suppressedCount,
      decryption_failures: decryptionFailures,
    };
  }

  private async fetchMessagePage(
    serverUrl: string,
    token: string,
    id: string,
    afterSeq: number,
    limit: number,
  ): Promise<{ messages: unknown[]; hasMore: boolean }> {
    const url = new URL(`/v3/sessions/${encodeURIComponent(id)}/messages`, `${serverUrl}/`);
    url.searchParams.set('after_seq', String(afterSeq));
    url.searchParams.set('limit', String(limit));
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        'x-happy-client': `personal-mcp-happy-bridge/${this.options.supportedVersion}`,
      },
      signal: AbortSignal.timeout(10_000),
    }).catch((error: unknown) => {
      throw new BridgeError(502, `Could not retrieve Happy messages: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (!response.ok) throw new BridgeError(502, `Happy rejected message retrieval (HTTP ${response.status})`);
    const payload = objectValue(await response.json().catch(() => {
      throw new BridgeError(502, 'Happy returned invalid message JSON');
    }), 'Happy message response');
    if (!Array.isArray(payload.messages)) throw new BridgeError(502, 'Happy message response is missing messages');
    return { messages: payload.messages, hasMore: payload.hasMore === true };
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
    if (sessions[id] === undefined) throw new BridgeError(404, 'session is not known to this Happy installation');
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

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function nonNegativeInteger(value: unknown, name: string, statusCode: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new BridgeError(statusCode, `${name} must be a non-negative integer`);
  }
  return value;
}

function optionalBoundedInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new BridgeError(400, `${name} must be an integer between ${minimum} and ${maximum}`);
  }
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

function eventSubtype(content: JsonObject): string | undefined {
  const data = isObject(content.data) ? content.data : undefined;
  const candidates = [data?.type, data?.t, content.type];
  return candidates.find((value): value is string => typeof value === 'string');
}

function classifyMessage(role: string, contentType: unknown, subtype: string | undefined): string {
  if (role === 'user') return 'message';
  const value = `${typeof contentType === 'string' ? contentType : ''}:${subtype ?? ''}`.toLowerCase();
  if (value.includes('tool-result') || value.includes('tool_result')) return 'tool_result';
  if (value.includes('tool-call') || value.includes('tool_call')) return 'tool_call';
  if (value.includes('reason')) return 'reasoning';
  if (value.includes('error') || value.includes('fail')) return 'error';
  if (value.includes('complete') || value.includes('finish') || value.includes('done')) return 'completion';
  if (value.includes('status') || value.includes('progress') || value.includes('event')) return 'status';
  if (value.includes('message') || value.includes('output') || value.includes('text')) return 'message';
  return 'unknown';
}

function extractMessageText(content: JsonObject): string | undefined {
  const prioritized = ['text', 'message', 'output', 'error', 'result', 'content'];
  for (const key of prioritized) {
    const found = textFromValue(content[key], 0);
    if (found) return found;
  }
  const data = textFromValue(content.data, 0);
  return data || undefined;
}

function textFromValue(value: unknown, depth: number): string | undefined {
  if (depth > 4 || value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value.map((entry) => textFromValue(entry, depth + 1)).filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? parts.join('\n') : undefined;
  }
  if (!isObject(value)) return undefined;
  for (const key of ['text', 'message', 'output', 'error', 'result', 'content', 'data']) {
    const found = textFromValue(value[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

function truncateText(value: string | undefined, maximum: number): { text?: string; truncated: boolean } {
  if (!value) return { truncated: false };
  if (value.length <= maximum) return { text: value, truncated: false };
  return { text: value.slice(0, maximum), truncated: true };
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
