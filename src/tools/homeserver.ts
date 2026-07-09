import { z } from 'zod';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { ServiceConfig } from '../config.js';
import { HomeserverClient } from '../clients/homeserverClient.js';
import { HttpClient } from '../http.js';
import { decryptMediaDownloadLink, encryptMediaDownloadLink } from '../mediaDownloadToken.js';
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

const MediaDownloadCategorySchema = z.enum(['movies', 'tv']);

const SearchMediaDownloadsArgsSchema = z.object({
  search: z.string().min(1),
  category: MediaDownloadCategorySchema,
});

const AddMediaDownloadArgsSchema = z.object({
  downloadToken: z.string().min(1),
  category: MediaDownloadCategorySchema,
});

export function homeserverTools(config?: ServiceConfig, mediaDownloadSecret = ''): ToolDefinition[] {
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
        name: 'homeserver_search_personal_media_downloads',
        title: 'Search Personal Media Downloads',
        description: 'Search for personal media downloads by text and media category.',
        inputSchema: zodToJsonSchemaObject({
          search: { type: 'string', minLength: 1 },
          category: { type: 'string', enum: ['movies', 'tv'] },
        }, ['search', 'category']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(SearchMediaDownloadsArgsSchema, args);
        if (!client) {
          return disabledResult('Homeserver');
        }

        const results = await client.searchTorrents(parsed.search, parsed.category);
        return jsonResult(encryptMediaDownloadResults(results, mediaDownloadSecret));
      },
    },
    {
      tool: {
        name: 'homeserver_add_personal_media_download',
        title: 'Add Personal Media Download',
        description: 'Add a selected personal media download to the movies or tv media library.',
        inputSchema: zodToJsonSchemaObject({
          downloadToken: { type: 'string', minLength: 1 },
          category: { type: 'string', enum: ['movies', 'tv'] },
        }, ['downloadToken', 'category']),
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(AddMediaDownloadArgsSchema, args);
        if (!client) {
          return disabledResult('Homeserver');
        }

        return jsonResult(await client.addTorrent(decryptDownloadToken(parsed.downloadToken, mediaDownloadSecret), parsed.category));
      },
    },
  ];
}

function encryptMediaDownloadResults(results: unknown, secret: string): unknown {
  if (!Array.isArray(results)) {
    return results;
  }

  return results.map((result) => {
    if (!isObject(result) || typeof result.download !== 'string') {
      return result;
    }

    const { download, ...rest } = result;
    return {
      ...rest,
      downloadToken: encryptMediaDownloadLink(download, secret),
    };
  });
}

function decryptDownloadToken(downloadToken: string, secret: string): string {
  try {
    return decryptMediaDownloadLink(downloadToken, secret);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid personal media download token';
    throw new McpError(ErrorCode.InvalidParams, message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
