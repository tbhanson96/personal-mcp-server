import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { AppConfig } from './config.js';
import { MCP_READ_SCOPE, MCP_TOOLS_SCOPE, McpAuthContext } from './auth.js';
import { homeAssistantTools } from './tools/homeAssistant.js';
import { homeserverTools } from './tools/homeserver.js';
import { mealieTools } from './tools/mealie.js';
import { ToolDefinition } from './tools/types.js';
import { vikunjaTools } from './tools/vikunja.js';

export function createToolDefinitions(config: AppConfig): ToolDefinition[] {
  return [
    ...homeAssistantTools(config.homeAssistant),
    ...homeserverTools(config.homeserver, config.mcpApiKey),
    ...mealieTools(config.mealie),
    ...vikunjaTools(config.vikunja),
  ];
}

export function createMcpServer(config: AppConfig, authContext: McpAuthContext = { scopes: [MCP_READ_SCOPE] }): Server {
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((definition) => ({
      ...definition.tool,
      securitySchemes: [{
        type: 'oauth2',
        scopes: securityScopesForTool(definition),
      }],
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const definition = toolsByName.get(request.params.name);
    if (!definition) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
    if (requiresToolsScope(definition) && !authContext.scopes.includes(MCP_TOOLS_SCOPE)) {
      return insufficientScopeResult(config, definition.tool.name);
    }

    return definition.execute(request.params.arguments || {});
  });

  return server;
}

export function securityScopesForTool(definition: ToolDefinition): string[] {
  return [requiresToolsScope(definition) ? MCP_TOOLS_SCOPE : MCP_READ_SCOPE];
}

export function requiresToolsScope(definition: ToolDefinition): boolean {
  return definition.tool.annotations?.readOnlyHint === false;
}

export function insufficientScopeResult(config: AppConfig, toolName: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `Additional authorization is required to call ${toolName}.`,
      },
    ],
    isError: true,
    _meta: {
      'mcp/www_authenticate': [
        `Bearer resource_metadata="${config.oauth.issuer}/.well-known/oauth-protected-resource", scope="${MCP_TOOLS_SCOPE}", error="insufficient_scope", error_description="${toolName} requires ${MCP_TOOLS_SCOPE}"`,
      ],
    },
  };
}
