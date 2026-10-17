import { ServiceConfig } from '../config.js';
import { MCP_CONTROL_SCOPE } from '../auth.js';
import { HttpClient } from '../http.js';
import { HomeAssistantClient } from '../clients/homeAssistantClient.js';
import { EmptyArgsSchema, parseArgs, zodToJsonSchemaObject } from '../schemas/common.js';
import { disabledResult, jsonResult, ToolDefinition } from './types.js';
import { z } from 'zod';

const StateArgsSchema = z.object({
  entity_id: z.string().min(1),
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
        name: 'home_assistant_play_spotify',
        title: 'Play Spotify Through Home Assistant',
        description: 'Play an exact Spotify URI on the single Home Assistant Spotify player, using its current connected device (normally the Mac mini). Resolve a named song to a Spotify URI with Spotify search first.',
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
