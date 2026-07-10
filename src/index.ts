import express, { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';
import { loadConfig } from './config.js';
import {
  authorizationServerMetadata,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  protectedResourceMetadata,
  redirectWithCode,
  registerOAuthClient,
  renderAuthorizePage,
  requireMcpAuth,
} from './auth.js';
import { logError, logInfo, requestLogDetails } from './logging.js';

const config = loadConfig();
const app = express();

app.use((request: Request, response: Response, next) => {
  const startedAt = Date.now();

  response.on('finish', () => {
    logInfo('http.request', {
      ...requestLogDetails(request),
      statusCode: response.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
});

app.get('/health', (_request: Request, response: Response) => {
  response.json({ ok: true });
});

app.get('/.well-known/oauth-protected-resource', (_request: Request, response: Response) => {
  response.json(protectedResourceMetadata(config));
});

app.get('/.well-known/oauth-authorization-server', (_request: Request, response: Response) => {
  response.json(authorizationServerMetadata(config));
});

app.get('/.well-known/openid-configuration', (_request: Request, response: Response) => {
  response.json(authorizationServerMetadata(config));
});

app.post('/oauth/register', express.json({ limit: '64kb' }), (request: Request, response: Response) => {
  try {
    const client = registerOAuthClient(request.body || {});
    response.status(201).json({
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  } catch (error) {
    response.status(400).json(oauthError('invalid_client_metadata', error));
  }
});

app.get('/oauth/authorize', (request: Request, response: Response) => {
  response.type('html').send(renderAuthorizePage(request.query, config));
});

app.post('/oauth/authorize', express.urlencoded({ extended: false, limit: '64kb' }), (request: Request, response: Response) => {
  try {
    const code = createAuthorizationCode(request.body || {}, config);
    response.redirect(302, redirectWithCode(request.body || {}, code));
  } catch (error) {
    response.status(400).json(oauthError('invalid_request', error));
  }
});

app.post('/oauth/token', express.urlencoded({ extended: false, limit: '64kb' }), (request: Request, response: Response) => {
  try {
    response.json(exchangeAuthorizationCode(request.body || {}, config));
  } catch (error) {
    response.status(400).json(oauthError('invalid_grant', error));
  }
});

app.post('/mcp', requireMcpAuth(config), express.json({ limit: '2mb' }), async (request: Request, response: Response) => {
  const server = createMcpServer(config);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    logError('mcp.request.failed', {
      ...requestLogDetails(request),
      error: error instanceof Error ? error.message : 'Unknown MCP request failure',
    });
    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error.',
        },
        id: null,
      });
    }
  } finally {
    await transport.close();
    await server.close();
  }
});

app.all('/mcp', requireMcpAuth(config), (_request: Request, response: Response) => {
  response.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Method not allowed.',
    },
    id: null,
  });
});

const httpServer = app.listen(config.port, config.bindAddress, () => {
  logInfo('server.started', {
    bindAddress: config.bindAddress,
    port: config.port,
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    httpServer.close((error) => {
      if (error) {
        logError('server.close.failed', {
          error: error.message,
        });
        process.exit(1);
      }

      process.exit(0);
    });
  });
}

function oauthError(code: string, error: unknown) {
  return {
    error: code,
    error_description: error instanceof Error ? error.message : 'OAuth request failed',
  };
}
