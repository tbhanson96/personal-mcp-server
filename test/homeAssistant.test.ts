import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { MCP_CONTROL_SCOPE } from '../src/auth.js';
import { homeAssistantTools } from '../src/tools/homeAssistant.js';

type CapturedRequest = {
  method?: string;
  url?: string;
  authorization?: string;
  body?: unknown;
};

describe('Home Assistant tools', () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
    servers.length = 0;
  });

  it('sets a validated Fahrenheit thermostat target with climate.set_temperature', async () => {
    const { baseUrl, requests } = await startHomeAssistantStub(servers, []);
    const tool = toolNamed(baseUrl, 'home_assistant_set_temperature');

    const result = await tool.execute({
      entity_id: 'climate.hallway_hallway',
      temperature_fahrenheit: 68.5,
    });

    expect(resultJson(result)).toEqual({
      success: true,
      entity_id: 'climate.hallway_hallway',
      temperature_fahrenheit: 68.5,
    });
    expect(requests).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: '/api/services/climate/set_temperature',
        authorization: 'Bearer ha-secret',
        body: {
          entity_id: 'climate.hallway_hallway',
          temperature: 68.5,
        },
      }),
    ]);
  });

  it('rejects invalid climate entities and Fahrenheit targets before any network call', async () => {
    const { baseUrl, requests } = await startHomeAssistantStub(servers, []);
    const tool = toolNamed(baseUrl, 'home_assistant_set_temperature');

    await expect(tool.execute({
      entity_id: 'light.hallway',
      temperature_fahrenheit: 68,
    })).rejects.toThrow('Expected a climate entity_id');
    await expect(tool.execute({
      entity_id: 'climate.hallway_hallway',
      temperature_fahrenheit: 39.9,
    })).rejects.toThrow();
    await expect(tool.execute({
      entity_id: 'climate.hallway_hallway',
      temperature_fahrenheit: 95.1,
    })).rejects.toThrow();

    expect(requests).toEqual([]);
  });

  it('reports a Home Assistant service failure instead of returning false success', async () => {
    const { baseUrl } = await startHomeAssistantStub(servers, [], 500);
    const tool = toolNamed(baseUrl, 'home_assistant_set_temperature');

    await expect(tool.execute({
      entity_id: 'climate.hallway_hallway',
      temperature_fahrenheit: 68,
    })).rejects.toThrow('POST /api/services/climate/set_temperature failed: 500');
  });

  it('returns sanitized playback state and capability flags', async () => {
    const { baseUrl, requests } = await startHomeAssistantStub(servers, [
      {
        entity_id: 'light.kitchen',
        state: 'on',
        attributes: { friendly_name: 'Kitchen' },
      },
      {
        entity_id: 'media_player.spotify_living_room',
        state: 'playing',
        last_changed: '2026-10-17T01:02:03Z',
        attributes: {
          friendly_name: 'Spotify Living Room',
          supported_features: 18999,
          volume_level: 0.35,
          source: 'Living Room speaker',
          source_list: ['Living Room speaker', 'Mac mini'],
          media_title: 'Through My System',
          media_artist: 'Its Murph, Arlo, Emi Grace',
          media_position: 42,
          access_token: 'must-not-leak',
          entity_picture: '/api/media_player_proxy/secret',
        },
      },
    ]);
    const tool = toolNamed(baseUrl, 'home_assistant_get_media_players');

    const result = await tool.execute({});
    const payload = resultJson(result);

    expect(payload).toEqual([expect.objectContaining({
      entity_id: 'media_player.spotify_living_room',
      state: 'playing',
      media_title: 'Through My System',
      media_artist: 'Its Murph, Arlo, Emi Grace',
      capabilities: {
        pause: true,
        resume: true,
        next: true,
        previous: true,
        seek: true,
        set_volume: true,
        select_source: true,
        play_media: true,
      },
    })]);
    expect(JSON.stringify(payload)).not.toContain('must-not-leak');
    expect(JSON.stringify(payload)).not.toContain('media_player_proxy');
    expect(requests).toEqual([expect.objectContaining({
      method: 'GET',
      url: '/api/states',
      authorization: 'Bearer ha-secret',
    })]);
  });

  it('plays on the single Spotify player and keeps its current connected source', async () => {
    const { baseUrl, requests } = await startHomeAssistantStub(servers, [spotifyState({
      source: 'Tim’s Mac mini',
      source_list: ['Tim’s Mac mini'],
    })]);
    const tool = toolNamed(baseUrl, 'home_assistant_play_spotify');

    const result = await tool.execute({
      spotify_uri: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
    });

    expect(resultJson(result)).toEqual({
      success: true,
      entity_id: 'media_player.spotify_living_room',
      spotify_uri: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
      media_content_type: 'track',
      source: 'Tim’s Mac mini',
    });
    expect(requests).toEqual([
      expect.objectContaining({
        method: 'GET',
        url: '/api/states',
        authorization: 'Bearer ha-secret',
      }),
      expect.objectContaining({
        method: 'POST',
        url: '/api/services/media_player/play_media',
        authorization: 'Bearer ha-secret',
        body: {
          entity_id: 'media_player.spotify_living_room',
          media_content_id: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
          media_content_type: 'track',
        },
      }),
    ]);
  });

  it('selects the Mac mini automatically when no source is currently connected', async () => {
    const { baseUrl, requests } = await startHomeAssistantStub(servers, [spotifyState({
      source_list: ['Tim’s Mac mini', 'Other'],
    })]);
    const tool = toolNamed(baseUrl, 'home_assistant_play_spotify');

    await tool.execute({ spotify_uri: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh' });

    expect(requests.filter(({ method }) => method === 'POST')).toEqual([
      expect.objectContaining({
        url: '/api/services/media_player/select_source',
        body: { entity_id: 'media_player.spotify_living_room', source: 'Tim’s Mac mini' },
      }),
      expect.objectContaining({ url: '/api/services/media_player/play_media' }),
    ]);
  });

  it('maps bounded playback actions to Home Assistant media-player services', async () => {
    const { baseUrl, requests } = await startHomeAssistantStub(servers, [spotifyState({ source: 'Tim’s Mac mini' })]);
    const tool = toolNamed(baseUrl, 'home_assistant_control_media_player');
    const entity_id = 'media_player.spotify_living_room';

    await tool.execute({ action: 'pause' });
    await tool.execute({ action: 'resume' });
    await tool.execute({ action: 'next' });
    await tool.execute({ action: 'previous' });
    await tool.execute({ action: 'seek', seek_position_seconds: 73.5 });
    await tool.execute({ action: 'set_volume', volume_level: 0.42 });

    expect(requests.filter(({ method }) => method === 'POST').map(({ url, body }) => ({ url, body }))).toEqual([
      { url: '/api/services/media_player/media_pause', body: { entity_id } },
      { url: '/api/services/media_player/media_play', body: { entity_id } },
      { url: '/api/services/media_player/media_next_track', body: { entity_id } },
      { url: '/api/services/media_player/media_previous_track', body: { entity_id } },
      { url: '/api/services/media_player/media_seek', body: { entity_id, seek_position: 73.5 } },
      { url: '/api/services/media_player/volume_set', body: { entity_id, volume_level: 0.42 } },
    ]);
  });

  it('fails safely if no Spotify player exists', async () => {
    const { baseUrl, requests } = await startHomeAssistantStub(servers, []);
    const tool = toolNamed(baseUrl, 'home_assistant_play_spotify');

    await expect(tool.execute({
      spotify_uri: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
    })).rejects.toThrow('No Home Assistant Spotify media player');

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
  });

  it('rejects invented URIs and incomplete action arguments before network calls', async () => {
    const { baseUrl, requests } = await startHomeAssistantStub(servers, []);
    const playTool = toolNamed(baseUrl, 'home_assistant_play_spotify');
    const controlTool = toolNamed(baseUrl, 'home_assistant_control_media_player');

    await expect(playTool.execute({
      spotify_uri: 'https://example.com/audio.mp3',
    })).rejects.toThrow();
    await expect(controlTool.execute({
      action: 'seek',
    })).rejects.toThrow();
    await expect(controlTool.execute({
      action: 'set_volume',
      volume_level: 2,
    })).rejects.toThrow();

    expect(requests).toEqual([]);
  });

  it('requires control scope and never accepts credentials in tool arguments', () => {
    const tools = homeAssistantTools({ baseUrl: 'http://ha.invalid', token: 'server-side-only' });
    for (const name of ['home_assistant_set_temperature', 'home_assistant_play_spotify', 'home_assistant_control_media_player']) {
      const tool = tools.find((candidate) => candidate.tool.name === name);
      expect(tool?.securityScopes).toEqual([MCP_CONTROL_SCOPE]);
      expect(tool?.tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
      expect(tool?.tool.inputSchema.properties).not.toHaveProperty('token');
      expect(tool?.tool.inputSchema.properties).not.toHaveProperty('password');
      if (name !== 'home_assistant_set_temperature') {
        expect(tool?.tool.inputSchema.properties).not.toHaveProperty('entity_id');
        expect(tool?.tool.inputSchema.properties).not.toHaveProperty('source');
      }
    }
  });
});

function toolNamed(baseUrl: string, name: string) {
  const tool = homeAssistantTools({ baseUrl, token: 'ha-secret' })
    .find((candidate) => candidate.tool.name === name);
  if (!tool) {
    throw new Error(`Missing tool: ${name}`);
  }
  return tool;
}

function resultJson(result: Awaited<ReturnType<ReturnType<typeof toolNamed>['execute']>>): unknown {
  const content = result.content[0];
  if (content?.type !== 'text') {
    throw new Error('Expected text result');
  }
  return JSON.parse(content.text);
}

async function startHomeAssistantStub(
  servers: ReturnType<typeof createServer>[],
  states: unknown[],
  postErrorStatus?: number,
): Promise<{ baseUrl: string; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    let rawBody = '';
    request.on('data', (chunk) => {
      rawBody += chunk;
    });
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: rawBody ? JSON.parse(rawBody) : undefined,
      });
      if (request.method === 'POST' && postErrorStatus) {
        response.writeHead(postErrorStatus, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Service call failed' }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      if (request.method === 'GET' && request.url?.startsWith('/api/states/')) {
        const entityId = decodeURIComponent(request.url.slice('/api/states/'.length));
        response.end(JSON.stringify(states.find((state) => (
          typeof state === 'object' && state !== null && 'entity_id' in state && state.entity_id === entityId
        )) || {
          entity_id: entityId,
          state: 'idle',
          attributes: {
            supported_features: 18999,
            source_list: ['Living Room speaker', 'Mac mini'],
          },
        }));
        return;
      }
      response.end(JSON.stringify(request.method === 'GET' ? states : []));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests };
}

function spotifyState(attributes: Record<string, unknown> = {}) {
  return {
    entity_id: 'media_player.spotify_living_room',
    state: 'idle',
    attributes: {
      friendly_name: 'Spotify Living Room',
      supported_features: 18999,
      source_list: ['Tim’s Mac mini'],
      ...attributes,
    },
  };
}
