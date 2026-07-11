import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { AppConfig } from './config.js';
import { MCP_READ_SCOPE } from './auth.js';
import { logError, logInfo, sanitizeForLog } from './logging.js';
import { discoveryTools } from './tools/discovery.js';
import { homeAssistantTools } from './tools/homeAssistant.js';
import { homeserverTools } from './tools/homeserver.js';
import { mealieTools } from './tools/mealie.js';
import { ToolDefinition } from './tools/types.js';
import { vikunjaTools } from './tools/vikunja.js';

export function createToolDefinitions(config: AppConfig): ToolDefinition[] {
  const serviceTools = [
    ...homeAssistantTools(config.homeAssistant),
    ...homeserverTools(config.homeserver, config.mcpApiKey),
    ...mealieTools(config.mealie),
    ...vikunjaTools(config.vikunja),
  ];

  return [
    ...discoveryTools(serviceTools),
    ...serviceTools,
  ];
}

export function createMcpServer(config: AppConfig): Server {
  const tools = createToolDefinitions(config);
  const toolsByName = new Map(tools.map((definition) => [definition.tool.name, definition]));

  const server = new Server(
    {
      name: 'personal-mcp-server',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: [
        'Use these tools to inspect and operate personal local services.',
        'Write tools are exposed as bounded semantic operations rather than raw API passthroughs.',
        'If a service is not configured, its tools return a configuration error instead of failing registration.',
      ].join(' '),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const returnedTools = tools.map((definition) => ({
      ...definition.tool,
      securitySchemes: [{
        type: 'oauth2',
        scopes: securityScopesForTool(definition),
      }],
    }));

    logInfo('mcp.tools.list.returned', {
      count: returnedTools.length,
      tools: returnedTools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        annotations: tool.annotations,
        securitySchemes: tool.securitySchemes,
        inputSchema: tool.inputSchema,
      })),
    });

    return {
      tools: returnedTools,
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const definition = toolsByName.get(request.params.name);
    if (!definition) {
      logError('mcp.tool.call.unknown', {
        toolName: request.params.name,
      });
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }

    logInfo('mcp.tool.call.started', {
      toolName: request.params.name,
      arguments: sanitizeForLog(request.params.arguments || {}),
    });

    const result = await definition.execute(request.params.arguments || {});

    logInfo('mcp.tool.call.returned', {
      toolName: request.params.name,
      isError: result.isError,
      result: sanitizeForLog(result),
    });

    return result;
  });

  return server;
}

export function securityScopesForTool(definition: ToolDefinition): string[] {
  return [MCP_READ_SCOPE];
}
