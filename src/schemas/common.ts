import { z } from 'zod';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

export const EmptyArgsSchema = z.object({}).passthrough();

export function parseArgs<T>(schema: z.ZodType<T>, args: Record<string, unknown>): T {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new McpError(ErrorCode.InvalidParams, parsed.error.message);
  }

  return parsed.data;
}

export function zodToJsonSchemaObject(shape: Record<string, object>, required: string[] = []) {
  return {
    type: 'object' as const,
    properties: shape,
    required,
    additionalProperties: false,
  };
}
