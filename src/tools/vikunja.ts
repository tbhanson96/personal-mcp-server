import { z } from 'zod';
import { ServiceConfig } from '../config.js';
import { VikunjaClient } from '../clients/vikunjaClient.js';
import { HttpClient } from '../http.js';
import { EmptyArgsSchema, parseArgs, zodToJsonSchemaObject } from '../schemas/common.js';
import { disabledResult, jsonResult, ToolDefinition } from './types.js';

const ListTasksArgsSchema = z.object({
  page: z.number().int().positive().optional(),
  per_page: z.number().int().positive().max(100).optional(),
  search: z.string().optional(),
});

export function vikunjaTools(config?: ServiceConfig): ToolDefinition[] {
  const client = config ? new VikunjaClient(new HttpClient(config)) : undefined;

  return [
    {
      tool: {
        name: 'vikunja_list_projects',
        title: 'List Vikunja Projects',
        description: 'List visible Vikunja projects.',
        inputSchema: zodToJsonSchemaObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        parseArgs(EmptyArgsSchema, args);
        return client ? jsonResult(await client.listProjects()) : disabledResult('Vikunja');
      },
    },
    {
      tool: {
        name: 'vikunja_list_tasks',
        title: 'List Vikunja Tasks',
        description: 'List Vikunja tasks, optionally filtered by search text.',
        inputSchema: zodToJsonSchemaObject({
          page: { type: 'number' },
          per_page: { type: 'number', maximum: 100 },
          search: { type: 'string' },
        }),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(ListTasksArgsSchema, args);
        return client ? jsonResult(await client.listTasks(parsed)) : disabledResult('Vikunja');
      },
    },
  ];
}
