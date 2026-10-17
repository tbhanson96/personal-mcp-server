import { createDecipheriv } from 'node:crypto';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import { describe, expect, it, vi } from 'vitest';
import {
  assertAllowedDirectory,
  decryptHappyMessage,
  encryptHappyMessage,
  HappyBridge,
  normalizeHappyMessage,
} from '../src/happyBridge.js';

describe('Happy bridge security boundary', () => {
  it('accepts a real directory inside an allowlisted root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happy-bridge-root-'));
    const child = join(root, 'project');
    await mkdir(child);

    await expect(assertAllowedDirectory(child, [root])).resolves.toBe(await realpath(child));
  });

  it('rejects a directory outside every allowlisted root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happy-bridge-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'happy-bridge-outside-'));

    await expect(assertAllowedDirectory(outside, [root])).rejects.toThrow(`outside the allowed host roots: ${root}`);
  });

  it('produces Happy-compatible AES-256-GCM data-key messages', () => {
    const key = Buffer.alloc(32, 7);
    const nonce = Buffer.alloc(12, 9);
    const message = { role: 'user', content: { type: 'text', text: 'hello' } };
    const bundle = Buffer.from(encryptHappyMessage(message, key, 'dataKey', nonce));

    expect(bundle[0]).toBe(0);
    const decipher = createDecipheriv('aes-256-gcm', key, bundle.subarray(1, 13));
    decipher.setAuthTag(bundle.subarray(bundle.length - 16));
    const plaintext = Buffer.concat([
      decipher.update(bundle.subarray(13, bundle.length - 16)),
      decipher.final(),
    ]);
    expect(JSON.parse(plaintext.toString('utf8'))).toEqual(message);
    expect(decryptHappyMessage(bundle, key, 'dataKey')).toEqual(message);
  });

  it('produces Happy-compatible legacy secretbox messages', () => {
    const key = Buffer.alloc(32, 5);
    const nonce = Buffer.alloc(nacl.secretbox.nonceLength, 3);
    const message = { role: 'user', content: { type: 'text', text: 'legacy' } };
    const bundle = Buffer.from(encryptHappyMessage(message, key, 'legacy', nonce));
    const plaintext = nacl.secretbox.open(
      bundle.subarray(nacl.secretbox.nonceLength),
      bundle.subarray(0, nacl.secretbox.nonceLength),
      key,
    );

    expect(plaintext).not.toBeNull();
    expect(JSON.parse(Buffer.from(plaintext!).toString('utf8'))).toEqual(message);
    expect(decryptHappyMessage(bundle, key, 'legacy')).toEqual(message);
  });

  it('normalizes ACP messages and suppresses tool telemetry in summary mode', () => {
    const raw = {
      id: 'message-1',
      seq: 7,
      localId: null,
      createdAt: 100,
      updatedAt: 101,
    };
    const assistant = {
      role: 'agent',
      content: {
        type: 'acp',
        provider: 'codex',
        data: { type: 'message', message: 'Finished the change.' },
      },
      meta: { sentFrom: 'cli' },
    };
    const toolCall = {
      role: 'agent',
      content: {
        type: 'acp',
        provider: 'codex',
        data: { type: 'tool-call', message: 'npm test' },
      },
    };

    expect(normalizeHappyMessage(raw, assistant, 'summary', 1_000)).toMatchObject({
      seq: 7,
      role: 'agent',
      kind: 'message',
      text: 'Finished the change.',
      provider: 'codex',
      sent_from: 'cli',
      truncated: false,
    });
    expect(normalizeHappyMessage(raw, toolCall, 'summary', 1_000)).toBeUndefined();
    expect(normalizeHappyMessage(raw, toolCall, 'full', 4)).toMatchObject({
      kind: 'tool_call',
      text: 'npm ',
      truncated: true,
    });
  });

  it('forces yolo mode for session creation and prompts', async () => {
    const happyHome = await mkdtemp(join(tmpdir(), 'happy-bridge-yolo-'));
    const key = Buffer.alloc(32, 6);
    const sessionId = 'session_yolo';
    await writeFile(join(happyHome, 'sessions.json'), JSON.stringify({
      sessions: {
        [sessionId]: {
          encryptionKey: key.toString('base64'),
          encryptionVariant: 'dataKey',
          seq: 0,
          metadataVersion: 1,
          agentStateVersion: 1,
          metadata: {},
          savedAt: 1,
        },
      },
    }));
    await writeFile(join(happyHome, 'access.key'), JSON.stringify({ token: 'test-token' }));
    await writeFile(join(happyHome, 'settings.json'), JSON.stringify({ serverUrl: 'https://happy.test' }));
    await writeFile(join(happyHome, 'daemon.state.json'), JSON.stringify({ pid: process.pid, httpPort: 12345 }));
    let spawnBody: Record<string, unknown> | undefined;
    let promptBody: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1:12345/status')) {
        return new Response(JSON.stringify({ connected: true, cliVersion: '1.2.4' }), { status: 200 });
      }
      if (url.startsWith('http://127.0.0.1:12345/spawn-session')) {
        spawnBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ success: true, sessionId }), { status: 200 });
      }
      if (url.startsWith('http://127.0.0.1:12345/list')) {
        return new Response(JSON.stringify({
          children: [{ startedBy: 'daemon', happySessionId: sessionId, pid: process.pid }],
        }), { status: 200 });
      }
      if (url === `https://happy.test/v3/sessions/${sessionId}/messages`) {
        promptBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    try {
      const bridge = new HappyBridge({
        socketPath: join(happyHome, 'bridge.sock'),
        happyHome,
        allowedRoots: [happyHome],
        serverUrl: 'https://happy.test',
        supportedVersion: '1.2.4',
        maxPromptChars: 100_000,
      });
      await bridge.handle('/sessions/start', { directory: happyHome, permission_mode: 'read-only' });
      await bridge.handle('/sessions/prompt', {
        session_id: sessionId,
        prompt: 'Make the change.',
        permission_mode: 'read-only',
      });

      expect(spawnBody).toMatchObject({ permissionMode: 'yolo' });
      const encrypted = (promptBody?.messages as Array<{ content: string }>)[0].content;
      expect(decryptHappyMessage(Buffer.from(encrypted, 'base64'), key, 'dataKey')).toMatchObject({
        meta: { permissionMode: 'yolo' },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('retrieves decrypted messages with a sequence cursor', async () => {
    const happyHome = await mkdtemp(join(tmpdir(), 'happy-bridge-home-'));
    const key = Buffer.alloc(32, 4);
    const sessionId = 'session_123';
    await writeFile(join(happyHome, 'sessions.json'), JSON.stringify({
      sessions: {
        [sessionId]: {
          encryptionKey: key.toString('base64'),
          encryptionVariant: 'dataKey',
          seq: 3,
          metadataVersion: 1,
          agentStateVersion: 1,
          metadata: {},
          savedAt: 1,
        },
      },
    }));
    await writeFile(join(happyHome, 'access.key'), JSON.stringify({ token: 'test-token' }));
    await writeFile(join(happyHome, 'settings.json'), JSON.stringify({ serverUrl: 'https://happy.test' }));
    await writeFile(join(happyHome, 'daemon.state.json'), JSON.stringify({ pid: process.pid, httpPort: 12345 }));

    const bodies = [
      { role: 'user', content: { type: 'text', text: 'Do the work.' } },
      { role: 'agent', content: { type: 'acp', provider: 'codex', data: { type: 'tool-call', message: 'npm test' } } },
      { role: 'agent', content: { type: 'acp', provider: 'codex', data: { type: 'message', message: 'Done.' } } },
    ];
    const messages = bodies.map((body, index) => ({
      id: `message-${index + 1}`,
      seq: index + 1,
      localId: null,
      content: { t: 'encrypted', c: Buffer.from(encryptHappyMessage(body, key, 'dataKey')).toString('base64') },
      createdAt: 100 + index,
      updatedAt: 100 + index,
    }));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1:12345/list')) {
        return new Response(JSON.stringify({ children: [] }), { status: 200 });
      }
      if (url.startsWith('http://127.0.0.1:12345/status')) {
        return new Response(JSON.stringify({ connected: true, cliVersion: '1.2.4' }), { status: 200 });
      }
      expect(url).toContain(`/v3/sessions/${sessionId}/messages?after_seq=0&limit=50`);
      return new Response(JSON.stringify({ messages, hasMore: false }), { status: 200 });
    }));

    try {
      const bridge = new HappyBridge({
        socketPath: join(happyHome, 'bridge.sock'),
        happyHome,
        allowedRoots: [happyHome],
        serverUrl: 'https://happy.test',
        supportedVersion: '1.2.4',
        maxPromptChars: 100_000,
      });
      await expect(bridge.handle('/status', {})).resolves.toMatchObject({
        connected: true,
        allowed_roots: [happyHome],
        directory_guidance: expect.stringContaining('absolute host filesystem path'),
      });
      const result = await bridge.handle('/sessions/messages', { session_id: sessionId }) as Record<string, unknown>;
      expect(result).toMatchObject({
        session_id: sessionId,
        next_after_seq: 3,
        has_more: false,
        active: false,
        suppressed_count: 1,
        decryption_failures: 0,
      });
      expect(result.messages).toMatchObject([
        { seq: 1, role: 'user', kind: 'message', text: 'Do the work.' },
        { seq: 3, role: 'agent', kind: 'message', text: 'Done.', provider: 'codex' },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
