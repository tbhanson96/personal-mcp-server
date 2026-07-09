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

const TorrentCategorySchema = z.enum(['movies', 'tv']);

const SearchTorrentsArgsSchema = z.object({
  search: z.string().min(1),
  category: TorrentCategorySchema,
});

const AddTorrentArgsSchema = z.object({
  magnet: z.string().min(1),
  category: TorrentCategorySchema,
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
    {
      tool: {
        name: 'homeserver_search_torrents',
        title: 'Search Homeserver Torrents',
        description: 'Search for torrents by text and media category.',
        inputSchema: zodToJsonSchemaObject({
          search: { type: 'string', minLength: 1 },
          category: { type: 'string', enum: ['movies', 'tv'] },
        }, ['search', 'category']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(SearchTorrentsArgsSchema, args);
        return client ? jsonResult(await client.searchTorrents(parsed.search, parsed.category)) : disabledResult('Homeserver');
      },
    },
    {
      tool: {
        name: 'homeserver_add_torrent',
        title: 'Add Homeserver Torrent',
        description: 'Add a torrent magnet link to Transmission in the movies or tv library.',
        inputSchema: zodToJsonSchemaObject({
          magnet: { type: 'string', minLength: 1 },
          category: { type: 'string', enum: ['movies', 'tv'] },
        }, ['magnet', 'category']),
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(AddTorrentArgsSchema, args);
        return client ? jsonResult(await client.addTorrent(parsed.magnet, parsed.category)) : disabledResult('Homeserver');
      },
    },
  ];
}
