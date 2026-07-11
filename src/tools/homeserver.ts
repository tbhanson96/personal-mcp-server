import { z } from 'zod';
import { ServiceConfig } from '../config.js';
import { HomeserverClient } from '../clients/homeserverClient.js';
import { HttpClient } from '../http.js';
import { EmptyArgsSchema, parseArgs, zodToJsonSchemaObject } from '../schemas/common.js';
import { disabledResult, jsonResult, ToolDefinition } from './types.js';

const ListFilesArgsSchema = z.object({
  path: z.string().default('/'),
});

const ListEbooksArgsSchema = z.object({
  library: z.string().default('books'),
});

const SearchArgsSchema = z.object({
  search: z.string().min(1),
});

export function homeserverTools(config?: ServiceConfig): ToolDefinition[] {
  const client = config ? new HomeserverClient(new HttpClient(config, config.token ? 'x-api-key' : 'Authorization')) : undefined;

  return [
    {
      tool: {
        name: 'homeserver_list_files',
        title: 'List Homeserver Files',
        description: 'List files and folders under a homeserver path.',
        inputSchema: zodToJsonSchemaObject({
          path: { type: 'string', default: '/' },
        }),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(ListFilesArgsSchema, args);
        return client ? jsonResult(await client.listFiles(parsed.path)) : disabledResult('Homeserver');
      },
    },
    {
      tool: {
        name: 'homeserver_list_ebooks',
        title: 'List Homeserver Ebooks',
        description: 'List ebooks or newspapers from the homeserver library.',
        inputSchema: zodToJsonSchemaObject({
          library: { type: 'string', default: 'books' },
        }),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(ListEbooksArgsSchema, args);
        return client ? jsonResult(await client.listEbooks(parsed.library)) : disabledResult('Homeserver');
      },
    },
    {
      tool: {
        name: 'homeserver_search_ebooks',
        title: 'Search Homeserver Ebooks',
        description: 'Search the configured homeserver ebook provider.',
        inputSchema: zodToJsonSchemaObject({
          search: { type: 'string', minLength: 1 },
        }, ['search']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(SearchArgsSchema, args);
        return client ? jsonResult(await client.searchEbooks(parsed.search)) : disabledResult('Homeserver');
      },
    },
    {
      tool: {
        name: 'homeserver_get_health_catalog',
        title: 'Get Homeserver Health Catalog',
        description: 'List available homeserver health metrics and coverage.',
        inputSchema: zodToJsonSchemaObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        parseArgs(EmptyArgsSchema, args);
        return client ? jsonResult(await client.getHealthCatalog()) : disabledResult('Homeserver');
      },
    },
  ];
}
