import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HappyBridgeClient } from '../src/clients/happyBridgeClient.js';

describe('HappyBridgeClient', () => {
  it('calls the bridge over a Unix socket', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'happy-bridge-client-'));
    const socketPath = join(directory, 'bridge.sock');
    const server = createServer((request, response) => {
      let raw = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { raw += chunk; });
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ path: request.url, body: JSON.parse(raw) }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    try {
      const result = await new HappyBridgeClient(socketPath).call('/sessions/prompt', { session_id: 'abc' });
      expect(result).toEqual({ path: '/sessions/prompt', body: { session_id: 'abc' } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns a sanitized bridge error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'happy-bridge-client-'));
    const socketPath = join(directory, 'bridge.sock');
    const server = createServer((_request, response) => {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'directory is not allowed' }));
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    try {
      await expect(new HappyBridgeClient(socketPath).call('/sessions/start')).rejects.toThrow('directory is not allowed');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
