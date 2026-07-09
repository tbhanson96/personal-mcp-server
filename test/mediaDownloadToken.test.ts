import { describe, expect, it } from 'vitest';
import { decryptMediaDownloadLink, encryptMediaDownloadLink } from '../src/mediaDownloadToken.js';

describe('media download tokens', () => {
  it('encrypts links without exposing the original value', () => {
    const link = 'magnet:?xt=urn:btih:1234567890abcdef';
    const token = encryptMediaDownloadLink(link, 'server-secret');

    expect(token).toMatch(/^pmd1\./);
    expect(token).not.toContain('magnet:');
    expect(token).not.toContain('1234567890abcdef');
    expect(decryptMediaDownloadLink(token, 'server-secret')).toBe(link);
  });

  it('rejects tokens encrypted with another secret', () => {
    const token = encryptMediaDownloadLink('magnet:?xt=urn:btih:1234567890abcdef', 'server-secret');

    expect(() => decryptMediaDownloadLink(token, 'other-secret')).toThrow(/Invalid personal media download token/);
  });

  it('rejects tampered tokens', () => {
    const token = encryptMediaDownloadLink('magnet:?xt=urn:btih:1234567890abcdef', 'server-secret');
    const tamperedToken = `${token.slice(0, -1)}A`;

    expect(() => decryptMediaDownloadLink(tamperedToken, 'server-secret')).toThrow(/Invalid personal media download token/);
  });
});
