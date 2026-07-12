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

const IsoDateTimeSchema = z.string().datetime({ offset: true });

const HealthMetricArgsSchema = z.object({
  metric: z.string().min(1),
  start: IsoDateTimeSchema,
  end: IsoDateTimeSchema,
});

const HealthStatisticsArgsSchema = z.object({
  metric: z.string().min(1),
  start: IsoDateTimeSchema,
  end: IsoDateTimeSchema,
  aggregation: z.enum(['hourly', 'daily']).default('daily'),
});

const HealthDailySummaryArgsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.'),
  metrics: z.array(z.string().min(1)).optional(),
});

const SleepDataArgsSchema = z.object({
  start: IsoDateTimeSchema,
  end: IsoDateTimeSchema,
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
        name: 'homeserver_query_health_metric',
        title: 'Query Homeserver Health Metric',
        description: 'Return raw time-series samples for one Apple Health metric between start and end ISO datetimes.',
        inputSchema: zodToJsonSchemaObject({
          metric: { type: 'string', minLength: 1, description: 'Metric name from homeserver_get_health_catalog, for example heart_rate.' },
          start: { type: 'string', format: 'date-time' },
          end: { type: 'string', format: 'date-time' },
        }, ['metric', 'start', 'end']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(HealthMetricArgsSchema, args);
        return client ? jsonResult(await client.queryHealthMetrics(parsed.start, parsed.end, [parsed.metric])) : disabledResult('Homeserver');
      },
    },
    {
      tool: {
        name: 'homeserver_get_health_statistics',
        title: 'Get Homeserver Health Statistics',
        description: 'Return aggregate statistics and hourly or daily buckets for one Apple Health metric.',
        inputSchema: zodToJsonSchemaObject({
          metric: { type: 'string', minLength: 1, description: 'Metric name from homeserver_get_health_catalog, for example heart_rate or resting_heart_rate.' },
          start: { type: 'string', format: 'date-time' },
          end: { type: 'string', format: 'date-time' },
          aggregation: { type: 'string', enum: ['hourly', 'daily'], default: 'daily' },
        }, ['metric', 'start', 'end']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(HealthStatisticsArgsSchema, args);
        return client ? jsonResult(await client.getHealthDashboard(parsed.start, parsed.end, [parsed.metric], parsed.aggregation)) : disabledResult('Homeserver');
      },
    },
    {
      tool: {
        name: 'homeserver_get_health_daily_summary',
        title: 'Get Homeserver Health Daily Summary',
        description: 'Return daily aggregate statistics for selected Apple Health metrics on one YYYY-MM-DD date. If metrics are omitted, all catalog metrics are summarized.',
        inputSchema: zodToJsonSchemaObject({
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Day to summarize in UTC, formatted YYYY-MM-DD.' },
          metrics: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            description: 'Optional metric names from homeserver_get_health_catalog.',
          },
        }, ['date']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(HealthDailySummaryArgsSchema, args);
        if (!client) {
          return disabledResult('Homeserver');
        }

        const [start, end] = dayRange(parsed.date);
        const metrics = parsed.metrics && parsed.metrics.length > 0
          ? parsed.metrics
          : await catalogMetricNames(client);
        return jsonResult(await client.getHealthDashboard(start, end, metrics, 'daily'));
      },
    },
    {
      tool: {
        name: 'homeserver_get_sleep_data',
        title: 'Get Homeserver Sleep Data',
        description: 'Return sleep records between start and end ISO datetimes.',
        inputSchema: zodToJsonSchemaObject({
          start: { type: 'string', format: 'date-time' },
          end: { type: 'string', format: 'date-time' },
        }, ['start', 'end']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(SleepDataArgsSchema, args);
        return client ? jsonResult(await client.getSleepData(parsed.start, parsed.end)) : disabledResult('Homeserver');
      },
    },
  ];
}

function dayRange(date: string): [string, string] {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

async function catalogMetricNames(client: HomeserverClient): Promise<string[]> {
  const catalog = await client.getHealthCatalog();
  if (!isObject(catalog) || !Array.isArray(catalog.metrics)) {
    return [];
  }

  return catalog.metrics
    .map((metric) => isObject(metric) && typeof metric.name === 'string' ? metric.name : undefined)
    .filter((metric): metric is string => Boolean(metric));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
