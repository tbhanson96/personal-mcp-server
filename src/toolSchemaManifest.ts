import { MCP_READ_SCOPE } from './auth.js';
import { ToolDefinition } from './tools/types.js';

export const TOOL_SCHEMA_MANIFEST_VERSION = 1;

export function securityScopesForTool(definition: ToolDefinition): string[] {
  return definition.securityScopes ?? [MCP_READ_SCOPE];
}

export function advertisedTools(definitions: ToolDefinition[]) {
  return definitions.map((definition) => ({
    ...definition.tool,
    securitySchemes: [{
      type: 'oauth2' as const,
      scopes: securityScopesForTool(definition),
    }],
  }));
}

export function createToolSchemaManifest(definitions: ToolDefinition[]) {
  return sortObjectKeys({
    manifestVersion: TOOL_SCHEMA_MANIFEST_VERSION,
    server: 'personal-mcp-server',
    tools: advertisedTools(definitions),
  });
}

export function serializeToolSchemaManifest(definitions: ToolDefinition[]): string {
  return `${JSON.stringify(createToolSchemaManifest(definitions), null, 2)}\n`;
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortObjectKeys(child)]),
    );
  }

  return value;
}
