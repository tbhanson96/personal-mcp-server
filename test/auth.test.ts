import { describe, expect, it } from 'vitest';
import { AppConfig } from '../src/config.js';
import { createAuthorizationCode, exchangeAuthorizationCode, isAuthorized } from '../src/auth.js';
import { createHash } from 'crypto';

const config: AppConfig = {
  port: 3000,
  bindAddress: '127.0.0.1',
  mcpApiKey: 'secret',
  publicUrl: 'https://example.com/mcp',
  oauth: {
    issuer: 'https://example.com',
    loginCode: 'login-code',
    tokenSigningSecret: 'signing-secret',
    accessTokenTtlSeconds: 3600,
  },
};

describe('isAuthorized', () => {
  it('accepts exact bearer and x-api-key credentials', () => {
    expect(isAuthorized('Bearer secret', undefined, config)).toBe(true);
    expect(isAuthorized(undefined, 'secret', config)).toBe(true);
  });

  it('rejects missing, malformed, and non-exact credentials', () => {
    expect(isAuthorized(undefined, undefined, config)).toBe(false);
    expect(isAuthorized('Bearer wrong', undefined, config)).toBe(false);
    expect(isAuthorized('Bearer secretx', undefined, config)).toBe(false);
    expect(isAuthorized('Basic secret', undefined, config)).toBe(false);
    expect(isAuthorized('bearer secret', undefined, config)).toBe(false);
    expect(isAuthorized(undefined, 'secretx', config)).toBe(false);
  });

  it('accepts OAuth access tokens minted for the MCP resource', () => {
    const verifier = 'oauth-test-verifier';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const redirectUri = 'https://chatgpt.com/connector/oauth/test';
    const clientId = 'chatgpt';
    const code = createAuthorizationCode({
      login_code: config.oauth.loginCode,
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: config.publicUrl,
      scope: 'mcp:read',
    }, config);

    const tokenResponse = exchangeAuthorizationCode({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource: config.publicUrl,
    }, config);

    expect(tokenResponse.access_token).toBeTruthy();
    expect(isAuthorized(`Bearer ${tokenResponse.access_token}`, undefined, config)).toBe(true);
  });
});
