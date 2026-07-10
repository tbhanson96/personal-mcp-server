import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { AppConfig } from './config.js';

type AuthorizationCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  expiresAt: number;
};

export type RegisteredClient = {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
  createdAt: number;
};

const authorizationCodes = new Map<string, AuthorizationCode>();
const registeredClients = new Map<string, RegisteredClient>();
const supportedScopes = ['mcp:tools'] as const;
const defaultScope = supportedScopes[0];

export function requireMcpAuth(config: AppConfig) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (isAuthorized(request.header('authorization'), request.header('x-api-key'), config)) {
      next();
      return;
    }

    response.setHeader('WWW-Authenticate', wwwAuthenticateHeader(config));
    response.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Unauthorized.',
      },
      id: null,
    });
  };
}

export function isAuthorized(
  authorizationHeader: string | undefined,
  apiKeyHeader: string | undefined,
  config: Pick<AppConfig, 'mcpApiKey' | 'oauth' | 'publicUrl'>,
): boolean {
  const token = bearerToken(authorizationHeader);
  return tokenMatches(token, config.mcpApiKey) ||
    tokenMatches(apiKeyHeader, config.mcpApiKey) ||
    isValidOAuthAccessToken(token, config);
}

function bearerToken(header: string | undefined): string | undefined {
  const prefix = 'Bearer ';
  if (!header?.startsWith(prefix)) {
    return undefined;
  }

  return header.slice(prefix.length);
}

function tokenMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate) {
    return false;
  }

  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  if (candidateBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(candidateBytes, expectedBytes);
}

export function protectedResourceMetadata(config: AppConfig) {
  return {
    resource: config.publicUrl,
    authorization_servers: [config.oauth.issuer],
    scopes_supported: supportedScopes,
    resource_documentation: `${config.oauth.issuer}/mcp`,
    token_endpoint_auth_methods_supported: ['none'],
  };
}

export function authorizationServerMetadata(config: AppConfig) {
  return {
    issuer: config.oauth.issuer,
    authorization_endpoint: `${config.oauth.issuer}/oauth/authorize`,
    token_endpoint: `${config.oauth.issuer}/oauth/token`,
    registration_endpoint: `${config.oauth.issuer}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: supportedScopes,
  };
}

export function registerOAuthClient(body: Record<string, unknown>): RegisteredClient {
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((uri): uri is string => typeof uri === 'string')
    : [];
  if (redirectUris.length === 0) {
    throw new Error('redirect_uris is required');
  }

  const client: RegisteredClient = {
    clientId: `client_${randomToken(24)}`,
    redirectUris,
    clientName: typeof body.client_name === 'string' ? body.client_name : undefined,
    createdAt: Date.now(),
  };
  registeredClients.set(client.clientId, client);
  return client;
}

export function renderAuthorizePage(query: Record<string, unknown>, config: AppConfig): string {
  const fields = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'];
  const hiddenFields = fields.map((field) => htmlHidden(field, stringParam(query[field]))).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize Personal MCP Server</title>
</head>
<body>
  <main>
    <h1>Authorize Personal MCP Server</h1>
    <p>Enter the MCP OAuth login code to let this client access personal tools.</p>
    <form method="post" action="/oauth/authorize">
      ${hiddenFields}
      <label>
        Login code
        <input type="password" name="login_code" autocomplete="current-password" required autofocus>
      </label>
      <button type="submit">Authorize</button>
    </form>
  </main>
</body>
</html>`;
}

export function createAuthorizationCode(body: Record<string, unknown>, config: AppConfig): string {
  const loginCode = stringParam(body.login_code);
  if (!tokenMatches(loginCode, config.oauth.loginCode)) {
    throw new Error('Invalid login code');
  }

  const responseType = stringParam(body.response_type);
  const clientId = stringParam(body.client_id);
  const redirectUri = stringParam(body.redirect_uri);
  const codeChallenge = stringParam(body.code_challenge);
  const codeChallengeMethod = stringParam(body.code_challenge_method);
  const resource = stringParam(body.resource) || config.publicUrl;
  const scope = normalizeScope(stringParam(body.scope) || defaultScope);

  if (responseType !== 'code') {
    throw new Error('Unsupported response_type');
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    throw new Error('Missing OAuth parameter');
  }
  if (codeChallengeMethod !== 'S256') {
    throw new Error('Only S256 PKCE is supported');
  }
  if (resource !== config.publicUrl) {
    throw new Error('Invalid resource');
  }
  if (!isRedirectUriAllowed(clientId, redirectUri)) {
    throw new Error('Invalid redirect_uri');
  }

  const code = `code_${randomToken(32)}`;
  authorizationCodes.set(code, {
    clientId,
    redirectUri,
    codeChallenge,
    resource,
    scope,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  return code;
}

export function exchangeAuthorizationCode(body: Record<string, unknown>, config: AppConfig) {
  const grantType = stringParam(body.grant_type);
  const code = stringParam(body.code);
  const redirectUri = stringParam(body.redirect_uri);
  const clientId = stringParam(body.client_id);
  const codeVerifier = stringParam(body.code_verifier);
  const resource = stringParam(body.resource) || config.publicUrl;

  if (grantType !== 'authorization_code') {
    throw new Error('Unsupported grant_type');
  }

  const record = authorizationCodes.get(code);
  authorizationCodes.delete(code);
  if (!record || Date.now() > record.expiresAt) {
    throw new Error('Invalid authorization code');
  }
  if (record.clientId !== clientId || record.redirectUri !== redirectUri || record.resource !== resource) {
    throw new Error('Authorization code mismatch');
  }
  if (!verifyPkce(codeVerifier, record.codeChallenge)) {
    throw new Error('Invalid code verifier');
  }

  const expiresIn = config.oauth.accessTokenTtlSeconds;
  return {
    access_token: signAccessToken({
      iss: config.oauth.issuer,
      aud: config.publicUrl,
      scope: record.scope,
      sub: 'personal-mcp-user',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expiresIn,
    }, config.oauth.tokenSigningSecret),
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: record.scope,
  };
}

export function redirectWithCode(body: Record<string, unknown>, code: string): string {
  const redirectUrl = new URL(stringParam(body.redirect_uri));
  redirectUrl.searchParams.set('code', code);
  const state = stringParam(body.state);
  if (state) {
    redirectUrl.searchParams.set('state', state);
  }
  return redirectUrl.toString();
}

export function wwwAuthenticateHeader(config: AppConfig): string {
  return `Bearer resource_metadata="${config.oauth.issuer}/.well-known/oauth-protected-resource", scope="${defaultScope}"`;
}

function isRedirectUriAllowed(clientId: string, redirectUri: string): boolean {
  if (redirectUri.startsWith('https://chatgpt.com/connector/oauth/') ||
    redirectUri === 'https://chatgpt.com/connector_platform_oauth_redirect') {
    return true;
  }

  const client = registeredClients.get(clientId);
  return Boolean(client?.redirectUris.includes(redirectUri));
}

function isValidOAuthAccessToken(
  token: string | undefined,
  config: Pick<AppConfig, 'oauth' | 'publicUrl'>,
): boolean {
  if (!token || tokenMatches(token, config.oauth.loginCode)) {
    return false;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = hmac(`${encodedHeader}.${encodedPayload}`, config.oauth.tokenSigningSecret);
  if (!tokenMatches(signature, expectedSignature)) {
    return false;
  }

  const payload = parseJson(base64UrlDecode(encodedPayload));
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  return payload.iss === config.oauth.issuer &&
    payload.aud === config.publicUrl &&
    typeof payload.exp === 'number' &&
    payload.exp > now &&
    typeof payload.scope === 'string' &&
    payload.scope.split(/\s+/).some((scope) => supportedScopes.includes(scope as (typeof supportedScopes)[number]));
}

function normalizeScope(scope: string): string {
  const requestedScopes = scope.split(/\s+/).filter(Boolean);
  const unsupportedScopes = requestedScopes.filter((requestedScope) =>
    !supportedScopes.includes(requestedScope as (typeof supportedScopes)[number]));
  if (unsupportedScopes.length > 0) {
    throw new Error(`Unsupported OAuth scope: ${unsupportedScopes.join(' ')}`);
  }

  return defaultScope;
}

function signAccessToken(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedHeader}.${encodedPayload}.${hmac(`${encodedHeader}.${encodedPayload}`, secret)}`;
}

function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) {
    return false;
  }

  return tokenMatches(base64UrlEncode(createHash('sha256').update(verifier).digest()), challenge);
}

function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function parseJson(value: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function stringParam(value: unknown): string {
  if (Array.isArray(value)) {
    return String(value[0] || '');
  }
  return typeof value === 'string' ? value : '';
}

function htmlHidden(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
