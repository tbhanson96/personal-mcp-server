import { ServiceConfig } from '../config.js';
import { MCP_CONTROL_SCOPE } from '../auth.js';
import { HttpClient } from '../http.js';
import { HomeAssistantClient } from '../clients/homeAssistantClient.js';
import { EmptyArgsSchema, parseArgs, zodToJsonSchemaObject } from '../schemas/common.js';
import { disabledResult, jsonResult, ToolDefinition } from './types.js';
import { z } from 'zod';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

const StateArgsSchema = z.object({
  entity_id: z.string().min(1),
});

const HOME_ASSISTANT_NAME_PATTERN = /^[a-z0-9_]+$/;
const HOME_ASSISTANT_ENTITY_ID_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const MAX_SERVICE_DATA_BYTES = 16 * 1024;

const ServiceDataSchema = z.record(z.string(), z.unknown())
  .refine(isJsonObject, 'service_data must contain only JSON-compatible values.')
  .refine(
    hasAllowedJsonSize,
    `service_data must not exceed ${MAX_SERVICE_DATA_BYTES} bytes.`,
  )
  .superRefine((value, context) => {
    for (const key of ['entity_id', 'device_id', 'area_id', 'target']) {
      if (Object.hasOwn(value, key)) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} must not be supplied in service_data; use the top-level entity_id.`,
        });
      }
    }
  });

const CallServiceArgsSchema = z.object({
  domain: z.string().trim().min(1).max(64).regex(HOME_ASSISTANT_NAME_PATTERN),
  service: z.string().trim().min(1).max(64).regex(HOME_ASSISTANT_NAME_PATTERN),
  entity_id: z.string().trim().max(255).regex(
    HOME_ASSISTANT_ENTITY_ID_PATTERN,
    'Expected a Home Assistant entity_id such as climate.tim_s_model_y_climate',
  ),
  service_data: ServiceDataSchema.optional(),
});

const CALL_SERVICE_ALLOWLIST = new Map<string, ReadonlySet<string>>([
  ['climate.turn_on', new Set(['climate.tim_s_model_y_climate'])],
]);

const MIN_THERMOSTAT_TEMPERATURE_FAHRENHEIT = 40;
const MAX_THERMOSTAT_TEMPERATURE_FAHRENHEIT = 95;

const SetTemperatureArgsSchema = z.object({
  entity_id: z.string()
    .regex(/^climate\.[a-z0-9_]+$/, 'Expected a climate entity_id'),
  temperature_fahrenheit: z.number()
    .finite()
    .min(MIN_THERMOSTAT_TEMPERATURE_FAHRENHEIT)
    .max(MAX_THERMOSTAT_TEMPERATURE_FAHRENHEIT),
});

const MediaPlayerEntityIdSchema = z.string()
  .regex(/^media_player\.[a-z0-9_]+$/, 'Expected a media_player entity_id');

const MediaPlayersArgsSchema = z.object({
  entity_id: MediaPlayerEntityIdSchema.optional(),
});

const PlaySpotifyArgsSchema = z.object({
  spotify_uri: z.string().regex(
    /^spotify:(track|album|playlist|episode):[A-Za-z0-9]+$/,
    'Expected a Spotify track, album, playlist, or episode URI',
  ),
});

const SearchSpotifyTracksArgsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

const PlaySpotifyTrackArgsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().min(1).max(200).optional(),
});

const MediaPlayerControlArgsSchema = z.object({
  action: z.enum(['pause', 'resume', 'next', 'previous', 'seek', 'set_volume']),
  seek_position_seconds: z.number().finite().min(0).optional(),
  volume_level: z.number().finite().min(0).max(1).optional(),
}).superRefine((value, context) => {
  if (value.action === 'seek' && value.seek_position_seconds === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['seek_position_seconds'],
      message: 'seek_position_seconds is required for seek.',
    });
  }
  if (value.action !== 'seek' && value.seek_position_seconds !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['seek_position_seconds'],
      message: 'seek_position_seconds is only valid for seek.',
    });
  }
  if (value.action === 'set_volume' && value.volume_level === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['volume_level'],
      message: 'volume_level is required for set_volume.',
    });
  }
  if (value.action !== 'set_volume' && value.volume_level !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['volume_level'],
      message: 'volume_level is only valid for set_volume.',
    });
  }
});

const ControlEntityArgsSchema = z.object({
  entity_id: z.string().regex(/^(light|switch|input_boolean|automation|script|scene)\.[a-zA-Z0-9_]+$/, 'Expected a supported Home Assistant entity_id'),
  action: z.enum(['turn_on', 'turn_off', 'toggle']),
}).superRefine((value, context) => {
  if (value.entity_id.startsWith('scene.') && value.action !== 'turn_on') {
    context.addIssue({
      code: 'custom',
      path: ['action'],
      message: 'Scenes only support turn_on.',
    });
  }
});

export function homeAssistantTools(config?: ServiceConfig): ToolDefinition[] {
  const client = config ? new HomeAssistantClient(new HttpClient(config)) : undefined;

  return [
    {
      tool: {
        name: 'home_assistant_get_config',
        title: 'Get Home Assistant Config',
        description: 'Read Home Assistant instance configuration.',
        inputSchema: zodToJsonSchemaObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        parseArgs(EmptyArgsSchema, args);
        return client ? jsonResult(await client.getConfig()) : disabledResult('Home Assistant');
      },
    },
    {
      tool: {
        name: 'home_assistant_get_states',
        title: 'Get Home Assistant States',
        description: 'List current Home Assistant entity states.',
        inputSchema: zodToJsonSchemaObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        parseArgs(EmptyArgsSchema, args);
        return client ? jsonResult(await client.getStates()) : disabledResult('Home Assistant');
      },
    },
    {
      tool: {
        name: 'home_assistant_get_state',
        title: 'Get Home Assistant Entity State',
        description: 'Read one Home Assistant entity state by entity_id.',
        inputSchema: zodToJsonSchemaObject({
          entity_id: { type: 'string', minLength: 1 },
        }, ['entity_id']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(StateArgsSchema, args);
        return client ? jsonResult(await client.getState(parsed.entity_id)) : disabledResult('Home Assistant');
      },
    },
    {
      tool: {
        name: 'home_assistant_control_entity',
        title: 'Control Home Assistant Entity',
        description: 'Turn on, turn off, or toggle a supported Home Assistant entity such as a light, switch, automation, script, scene, or input boolean.',
        inputSchema: zodToJsonSchemaObject({
          entity_id: {
            type: 'string',
            minLength: 1,
            description: 'A supported entity_id, for example light.living_room_2 or script.movie_time.',
          },
          action: { type: 'string', enum: ['turn_on', 'turn_off', 'toggle'] },
        }, ['entity_id', 'action']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(ControlEntityArgsSchema, args);
        return client ? jsonResult(await client.controlEntity(parsed.entity_id, parsed.action)) : disabledResult('Home Assistant');
      },
    },
    {
      tool: {
        name: 'home_assistant_set_temperature',
        title: 'Set Home Assistant Thermostat Temperature',
        description: 'Set the Fahrenheit target temperature of one Home Assistant climate entity. This changes the thermostat setpoint.',
        inputSchema: zodToJsonSchemaObject({
          entity_id: {
            type: 'string',
            pattern: '^climate\\.[a-z0-9_]+$',
            description: 'Exact climate entity_id, for example climate.hallway_hallway.',
          },
          temperature_fahrenheit: {
            type: 'number',
            minimum: MIN_THERMOSTAT_TEMPERATURE_FAHRENHEIT,
            maximum: MAX_THERMOSTAT_TEMPERATURE_FAHRENHEIT,
            description: 'Target temperature in degrees Fahrenheit (40–95 °F).',
          },
        }, ['entity_id', 'temperature_fahrenheit']),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      securityScopes: [MCP_CONTROL_SCOPE],
      execute: async (args) => {
        const parsed = parseArgs(SetTemperatureArgsSchema, args);
        return client
          ? jsonResult(await client.setTemperature(parsed.entity_id, parsed.temperature_fahrenheit))
          : disabledResult('Home Assistant');
      },
    },
    {
      tool: {
        name: 'home_assistant_call_service',
        title: 'Call an Allowlisted Home Assistant Service',
        description: 'Call a Home Assistant service only when its domain, service, and entity_id are explicitly allowlisted. Currently permits climate.turn_on only for climate.tim_s_model_y_climate; locks, covers and garages, alarms, security devices, scripts, scenes, automations, and all other operations are denied.',
        inputSchema: zodToJsonSchemaObject({
          domain: {
            type: 'string',
            pattern: '^[a-z0-9_]+$',
            maxLength: 64,
            description: 'Home Assistant service domain. The current allowlist accepts climate.',
          },
          service: {
            type: 'string',
            pattern: '^[a-z0-9_]+$',
            maxLength: 64,
            description: 'Home Assistant service name. The current allowlist accepts turn_on only.',
          },
          entity_id: {
            type: 'string',
            pattern: '^[a-z0-9_]+\\.[a-z0-9_]+$',
            maxLength: 255,
            description: 'Exact allowlisted entity_id. Currently climate.tim_s_model_y_climate only.',
          },
          service_data: {
            type: 'object',
            description: 'Optional JSON service data. Target selectors such as entity_id, device_id, area_id, and target are forbidden here; use the top-level entity_id.',
            additionalProperties: true,
          },
        }, ['domain', 'service', 'entity_id']),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      securityScopes: [MCP_CONTROL_SCOPE],
      execute: async (args) => {
        const parsed = parseArgs(CallServiceArgsSchema, args);
        assertAllowedServiceCall(parsed.domain, parsed.service, parsed.entity_id);
        return client
          ? jsonResult(await client.callService(
            parsed.domain,
            parsed.service,
            parsed.entity_id,
            parsed.service_data,
          ))
          : disabledResult('Home Assistant');
      },
    },
    {
      tool: {
        name: 'home_assistant_get_media_players',
        title: 'Get Home Assistant Media Players',
        description: 'List sanitized media-player playback state, available Spotify Connect sources, and supported playback capabilities. Optionally return one media_player entity.',
        inputSchema: zodToJsonSchemaObject({
          entity_id: {
            type: 'string',
            pattern: '^media_player\\.[a-z0-9_]+$',
            description: 'Optional exact media_player entity_id. Omit to list all players.',
          },
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      execute: async (args) => {
        const parsed = parseArgs(MediaPlayersArgsSchema, args);
        return client ? jsonResult(await client.getMediaPlayers(parsed.entity_id)) : disabledResult('Home Assistant');
      },
    },
    {
      tool: {
        name: 'home_assistant_search_spotify_tracks',
        title: 'Search Spotify Tracks Through Home Assistant',
        description: 'Search the Spotify catalog by track title and optional artist through the configured SpotifyPlus integration. Returns sanitized candidates with exact Spotify track URIs for disambiguation.',
        inputSchema: zodToJsonSchemaObject({
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description: 'Requested track title, without inventing a Spotify URI.',
          },
          artist: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description: 'Optional requested artist used to narrow and verify results.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
            description: 'Maximum sanitized candidates to return; defaults to 5.',
          },
        }, ['title']),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      execute: async (args) => {
        const parsed = parseArgs(SearchSpotifyTracksArgsSchema, args);
        return client
          ? jsonResult(await client.searchSpotifyTracks(parsed.title, parsed.artist, parsed.limit))
          : disabledResult('Home Assistant');
      },
    },
    {
      tool: {
        name: 'home_assistant_play_spotify_track',
        title: 'Play Named Spotify Track Through Home Assistant',
        description: 'Search and play a named Spotify track on the single Home Assistant Spotify player and its current connected device. Uses SpotifyPlus and plays only a confident title/artist match.',
        inputSchema: zodToJsonSchemaObject({
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description: 'Requested track title.',
          },
          artist: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description: 'Optional artist used to narrow and verify the match.',
          },
        }, ['title']),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      securityScopes: [MCP_CONTROL_SCOPE],
      execute: async (args) => {
        const parsed = parseArgs(PlaySpotifyTrackArgsSchema, args);
        return client
          ? jsonResult(await client.playSpotifyTrack(parsed.title, parsed.artist))
          : disabledResult('Home Assistant');
      },
    },
    {
      tool: {
        name: 'home_assistant_play_spotify',
        title: 'Play Spotify Through Home Assistant',
        description: 'Play an exact Spotify URI on the single Home Assistant Spotify player and its current connected device. For natural-language track requests, use home_assistant_play_spotify_track.',
        inputSchema: zodToJsonSchemaObject({
          spotify_uri: {
            type: 'string',
            pattern: '^spotify:(track|album|playlist|episode):[A-Za-z0-9]+$',
            description: 'Exact Spotify URI returned by Spotify search, for example spotify:track:4iV5W9uYEdYUVa79Axb7Rh.',
          },
        }, ['spotify_uri']),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      securityScopes: [MCP_CONTROL_SCOPE],
      execute: async (args) => {
        const parsed = parseArgs(PlaySpotifyArgsSchema, args);
        return client
          ? jsonResult(await client.playSpotify(parsed.spotify_uri))
          : disabledResult('Home Assistant');
      },
    },
    {
      tool: {
        name: 'home_assistant_control_media_player',
        title: 'Control Home Assistant Media Playback',
        description: 'Pause, resume, skip, seek, or set volume on the single Home Assistant Spotify player and its current connected device.',
        inputSchema: zodToJsonSchemaObject({
          action: {
            type: 'string',
            enum: ['pause', 'resume', 'next', 'previous', 'seek', 'set_volume'],
          },
          seek_position_seconds: {
            type: 'number',
            minimum: 0,
            description: 'Absolute playback position in seconds; required only for seek.',
          },
          volume_level: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Volume from 0 (silent) to 1 (maximum); required only for set_volume.',
          },
        }, ['action']),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      securityScopes: [MCP_CONTROL_SCOPE],
      execute: async (args) => {
        const parsed = parseArgs(MediaPlayerControlArgsSchema, args);
        return client
          ? jsonResult(await client.controlMediaPlayer(parsed.action, {
            seekPositionSeconds: parsed.seek_position_seconds,
            volumeLevel: parsed.volume_level,
          }))
          : disabledResult('Home Assistant');
      },
    },
  ];
}

function assertAllowedServiceCall(domain: string, service: string, entityId: string): void {
  const operation = `${domain}.${service}`;
  const allowedEntities = CALL_SERVICE_ALLOWLIST.get(operation);
  if (!allowedEntities?.has(entityId)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Home Assistant service call is not allowed by policy: ${operation} for ${entityId}`,
    );
  }
}

function isJsonObject(value: Record<string, unknown>): boolean {
  return isJsonValue(value, new Set(), 0);
}

function hasAllowedJsonSize(value: Record<string, unknown>): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_SERVICE_DATA_BYTES;
  } catch {
    return false;
  }
}

function isJsonValue(value: unknown, ancestors: Set<object>, depth: number): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= 10 || typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;

  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry, nextAncestors, depth + 1));
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every((entry) => isJsonValue(entry, nextAncestors, depth + 1));
}
