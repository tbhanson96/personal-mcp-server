import { z } from 'zod';
import { parseArgs, zodToJsonSchemaObject } from '../schemas/common.js';
import { jsonResult, ToolDefinition } from './types.js';

const RefreshTestArgsSchema = z.object({
  message: z.string().max(1_000).optional(),
});

export function refreshTestTools(): ToolDefinition[] {
  return [{
    tool: {
      name: 'personal_mcp_refresh_test',
      title: 'Test Personal MCP Tool Refresh',
      description: 'Temporary read-only tool for verifying that ChatGPT discovered the latest Personal MCP tool definitions. Call it with an optional short message and confirm the response echoes that message.',
      inputSchema: zodToJsonSchemaObject({
        message: { type: 'string', maxLength: 1_000, description: 'Optional text to echo in the refresh verification response.' },
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    execute: async (args) => {
      const parsed = parseArgs(RefreshTestArgsSchema, args);
      return jsonResult({
        ok: true,
        tool: 'personal_mcp_refresh_test',
        message: parsed.message ?? null,
        note: 'ChatGPT invoked the temporary Personal MCP refresh test tool successfully.',
      });
    },
    metadata: {
      category: 'personal-mcp',
      tags: ['personal-mcp', 'refresh', 'test', 'read'],
      examples: ['Call personal_mcp_refresh_test with message "hello from ChatGPT".'],
      workflowNotes: ['This tool is temporary and exists only to test ChatGPT tool metadata refreshes.'],
      changesState: false,
    },
  }];
}
