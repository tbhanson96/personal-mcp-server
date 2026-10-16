import { createDecipheriv } from 'node:crypto';
import { mkdtemp, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';
import { assertAllowedDirectory, encryptHappyMessage } from '../src/happyBridge.js';

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

    await expect(assertAllowedDirectory(outside, [root])).rejects.toThrow('outside HAPPY_BRIDGE_ALLOWED_ROOTS');
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
  });
});
