import express, { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = express();

app.use(express.json({ limit: '2mb' }));

app.get('/health', (_request: Request, response: Response) => {
  response.json({ ok: true });
});

app.post('/mcp', async (request: Request, response: Response) => {
  if (!isAuthorized(request)) {
    response.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Unauthorized.',
      },
      id: null,
    });
    return;
  }

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

app.all('/mcp', (_request: Request, response: Response) => {
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

function isAuthorized(request: Request): boolean {
  const header = request.header('authorization');
  const apiKey = request.header('x-api-key');

  return header === `Bearer ${config.mcpApiKey}` || apiKey === config.mcpApiKey;
}
