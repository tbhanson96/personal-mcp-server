import { describe, expect, it } from 'vitest';
import { decryptMediaDownloadLink, encryptMediaDownloadLink } from '../src/mediaDownloadToken.js';

describe('media download tokens', () => {
  it('encrypts links without exposing the original value', () => {
    const link = 'magnet:?xt=urn:btih:1234567890abcdef';
    const token = encryptMediaDownloadLink(link, 'server-secret');

    expect(token).toMatch(/^pmd2\./);
    expect(token).not.toContain('magnet:');
    expect(token).not.toContain('1234567890abcdef');
    expect(decryptMediaDownloadLink(token, 'server-secret')).toBe(link);
  });

  it('keeps long magnet links compact enough for MCP clients to echo back', () => {
    const link = [
      'magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678',
      'dn=ubuntu-26.04-desktop-amd64.iso',
      ...Array.from({ length: 20 }, (_, index) => `tr=udp%3A%2F%2Ftracker-${index}.example.test%3A6969%2Fannounce`),
    ].join('&');

    const token = encryptMediaDownloadLink(link, 'server-secret');

    expect(token.length).toBeLessThan(link.length);
    expect(decryptMediaDownloadLink(token, 'server-secret')).toBe(link);
  });

  it('tolerates whitespace added around or inside tokens', () => {
    const link = 'magnet:?xt=urn:btih:1234567890abcdef';
    const token = encryptMediaDownloadLink(link, 'server-secret');
    const wrappedToken = ` ${token.slice(0, 20)}\n${token.slice(20)} `;

    expect(decryptMediaDownloadLink(wrappedToken, 'server-secret')).toBe(link);
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
