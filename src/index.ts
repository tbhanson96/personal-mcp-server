import express, { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';
import { loadConfig } from './config.js';
import { requireMcpAuth } from './auth.js';

const config = loadConfig();
const app = express();

app.get('/health', (_request: Request, response: Response) => {
  response.json({ ok: true });
});

app.post('/mcp', requireMcpAuth(config.mcpApiKey), express.json({ limit: '2mb' }), async (request: Request, response: Response) => {
  const server = createMcpServer(config);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    console.error('MCP request failed:', error);
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

app.all('/mcp', requireMcpAuth(config.mcpApiKey), (_request: Request, response: Response) => {
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
  console.log(`personal-mcp-server listening on ${config.bindAddress}:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    httpServer.close((error) => {
      if (error) {
        console.error('Failed to close HTTP server:', error);
        process.exit(1);
      }

      process.exit(0);
    });
  });
}
