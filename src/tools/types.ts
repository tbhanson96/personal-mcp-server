import { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export type ToolDefinition = {
  tool: Tool;
  execute: (args: Record<string, unknown>) => Promise<CallToolResult>;
  metadata?: ToolMetadata;
};

export type ToolMetadata = {
  category: string;
  tags: string[];
  examples?: string[];
  relatedTools?: string[];
  workflowNotes?: string[];
  changesState?: boolean;
};

export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function disabledResult(serviceName: string): CallToolResult {
  return jsonResult({
    error: `${serviceName} is not configured. Set the service URL and token env vars, then restart the server.`,
  });
}
