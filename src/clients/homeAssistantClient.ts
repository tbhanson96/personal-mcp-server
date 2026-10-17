import { HttpClient } from '../http.js';

export type MediaPlayerAction = 'pause' | 'resume' | 'next' | 'previous' | 'seek' | 'set_volume';

type HomeAssistantState = {
  entity_id: string;
  state: string;
  last_changed?: string;
  last_updated?: string;
  attributes?: Record<string, unknown>;
};

export type MediaPlayerSummary = {
  entity_id: string;
  name?: string;
  state: string;
  available: boolean;
  device_class?: string;
  volume_level?: number;
  is_volume_muted?: boolean;
  source?: string;
  sources?: string[];
  media_content_type?: string;
  media_title?: string;
  media_artist?: string;
  media_album_name?: string;
  media_duration_seconds?: number;
  media_position_seconds?: number;
  media_position_updated_at?: string;
  supported_features?: number;
  capabilities: {
    pause: boolean;
    resume: boolean;
    next: boolean;
    previous: boolean;
    seek: boolean;
    set_volume: boolean;
    select_source: boolean;
    play_media: boolean;
  };
  last_changed?: string;
  last_updated?: string;
};

export type SpotifyTrackMatch = {
  name: string;
  artists: string[];
  album?: string;
  spotify_uri: string;
  duration_ms?: number;
  explicit?: boolean;
  is_playable?: boolean;
};

type SpotifyPlusSearchResponse = {
  service_response?: {
    result?: {
      items?: unknown[];
    };
  };
};

const MEDIA_PLAYER_FEATURE = {
  pause: 1,
  seek: 2,
  set_volume: 4,
  previous: 16,
  next: 32,
  play_media: 512,
  select_source: 2048,
  resume: 16384,
} as const;

export class HomeAssistantClient {
  constructor(private readonly http: HttpClient) {}

  getConfig(): Promise<unknown> {
    return this.http.get('/api/config');
  }

  getStates(): Promise<unknown> {
    return this.http.get('/api/states');
  }

  getState(entityId: string): Promise<unknown> {
    return this.http.get(`/api/states/${encodeURIComponent(entityId)}`);
  }

  async getMediaPlayers(entityId?: string): Promise<MediaPlayerSummary[]> {
    if (entityId) {
      const state = await this.http.get<HomeAssistantState>(`/api/states/${encodeURIComponent(entityId)}`);
      return [mediaPlayerSummary(state)];
    }

    const states = await this.http.get<HomeAssistantState[]>('/api/states');
    return states
      .filter((state) => state.entity_id.startsWith('media_player.'))
      .map(mediaPlayerSummary);
  }

  controlEntity(entityId: string, action: 'turn_on' | 'turn_off' | 'toggle'): Promise<unknown> {
    const domain = entityId.split('.')[0];
    return this.http.post(`/api/services/${encodeURIComponent(domain)}/${action}`, {
      entity_id: entityId,
    });
  }

  async callService(
    domain: string,
    service: string,
    entityId: string,
    serviceData: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    await this.http.post(
      `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
      {
        ...serviceData,
        entity_id: entityId,
      },
    );

    return {
      success: true,
      domain,
      service,
      entity_id: entityId,
    };
  }

  async setTemperature(entityId: string, temperatureFahrenheit: number): Promise<Record<string, unknown>> {
    await this.http.post('/api/services/climate/set_temperature', {
      entity_id: entityId,
      temperature: temperatureFahrenheit,
    });

    return {
      success: true,
      entity_id: entityId,
      temperature_fahrenheit: temperatureFahrenheit,
    };
  }

  async playSpotify(spotifyUri: string): Promise<Record<string, unknown>> {
    const player = await this.getDefaultSpotifyPlayer();
    return this.playSpotifyOnPlayer(player, spotifyUri);
  }

  async searchSpotifyTracks(title: string, artist?: string, limit = 5): Promise<SpotifyTrackMatch[]> {
    const player = await this.getDefaultSpotifyPlayer();
    return this.searchSpotifyTracksOnPlayer(player, title, artist, limit);
  }

  async playSpotifyTrack(title: string, artist?: string): Promise<Record<string, unknown>> {
    const player = await this.getDefaultSpotifyPlayer();
    const matches = await this.searchSpotifyTracksOnPlayer(player, title, artist, 10);
    const selected = selectSpotifyTrack(matches, title, artist);
    const playback = await this.playSpotifyOnPlayer(player, selected.spotify_uri);

    return {
      ...playback,
      matched_track: selected,
      requested_title: title,
      ...(artist ? { requested_artist: artist } : {}),
    };
  }

  private async playSpotifyOnPlayer(
    player: MediaPlayerSummary,
    spotifyUri: string,
  ): Promise<Record<string, unknown>> {
    assertCapability(player, 'play_media');
    const source = spotifySource(player);

    if (source.select) {
      assertCapability(player, 'select_source');
      await this.callMediaPlayerService('select_source', {
        entity_id: player.entity_id,
        source: source.name,
      });
    }

    const mediaContentType = spotifyUri.split(':')[1];
    await this.callMediaPlayerService('play_media', {
      entity_id: player.entity_id,
      media_content_id: spotifyUri,
      media_content_type: mediaContentType,
    });

    return {
      success: true,
      entity_id: player.entity_id,
      spotify_uri: spotifyUri,
      media_content_type: mediaContentType,
      source: source.name,
    };
  }

  private async searchSpotifyTracksOnPlayer(
    player: MediaPlayerSummary,
    title: string,
    artist: string | undefined,
    limit: number,
  ): Promise<SpotifyTrackMatch[]> {
    const criteria = [title, artist].filter(Boolean).join(' ');
    const response = await this.http.post<SpotifyPlusSearchResponse>(
      '/api/services/spotifyplus/search_tracks?return_response',
      {
        entity_id: player.entity_id,
        criteria,
        limit_total: limit,
      },
    );
    const items = response.service_response?.result?.items;
    if (!Array.isArray(items)) {
      throw new Error('SpotifyPlus search returned an unexpected response.');
    }

    return items.flatMap(sanitizeSpotifyTrack);
  }

  async controlMediaPlayer(
    action: MediaPlayerAction,
    options: { seekPositionSeconds?: number; volumeLevel?: number } = {},
  ): Promise<Record<string, unknown>> {
    const player = await this.getDefaultSpotifyPlayer();
    assertCapability(player, action);

    const service = {
      pause: 'media_pause',
      resume: 'media_play',
      next: 'media_next_track',
      previous: 'media_previous_track',
      seek: 'media_seek',
      set_volume: 'volume_set',
    }[action];
    const actionData = action === 'seek'
      ? { seek_position: options.seekPositionSeconds }
      : action === 'set_volume'
        ? { volume_level: options.volumeLevel }
        : {};

    await this.callMediaPlayerService(service, {
      entity_id: player.entity_id,
      ...actionData,
    });

    return {
      success: true,
      entity_id: player.entity_id,
      action,
      ...(action === 'seek' ? { seek_position_seconds: options.seekPositionSeconds } : {}),
      ...(action === 'set_volume' ? { volume_level: options.volumeLevel } : {}),
    };
  }

  private async getDefaultSpotifyPlayer(): Promise<MediaPlayerSummary> {
    const spotifyPlayers = (await this.getMediaPlayers()).filter(isSpotifyPlayer);
    if (spotifyPlayers.length === 0) {
      throw new Error('No Home Assistant Spotify media player is configured.');
    }
    if (spotifyPlayers.length > 1) {
      throw new Error('Expected exactly one Home Assistant Spotify media player.');
    }

    assertAvailable(spotifyPlayers[0]);
    return spotifyPlayers[0];
  }

  private callMediaPlayerService(service: string, data: Record<string, unknown>): Promise<unknown> {
    return this.http.post(`/api/services/media_player/${service}`, data);
  }
}

function sanitizeSpotifyTrack(value: unknown): SpotifyTrackMatch[] {
  if (!isRecord(value)
    || typeof value.name !== 'string'
    || typeof value.uri !== 'string'
    || !/^spotify:track:[A-Za-z0-9]+$/.test(value.uri)
    || !Array.isArray(value.artists)) {
    return [];
  }
  const artists = value.artists.flatMap((artist) => (
    isRecord(artist) && typeof artist.name === 'string' ? [artist.name] : []
  ));
  if (artists.length === 0) {
    return [];
  }

  const album = isRecord(value.album) && typeof value.album.name === 'string'
    ? value.album.name
    : undefined;
  return [{
    name: value.name,
    artists,
    ...(album ? { album } : {}),
    spotify_uri: value.uri,
    ...(typeof value.duration_ms === 'number' ? { duration_ms: value.duration_ms } : {}),
    ...(typeof value.explicit === 'boolean' ? { explicit: value.explicit } : {}),
    ...(typeof value.is_playable === 'boolean' ? { is_playable: value.is_playable } : {}),
  }];
}

function selectSpotifyTrack(matches: SpotifyTrackMatch[], title: string, artist?: string): SpotifyTrackMatch {
  const requestedTitle = normalizeSpotifyText(title);
  const requestedArtist = artist ? normalizeSpotifyText(artist) : undefined;
  const candidates = matches.filter((match) => (
    match.is_playable !== false
    && normalizedBaseTitle(match.name) === requestedTitle
    && (!requestedArtist || match.artists.some((name) => normalizeSpotifyText(name) === requestedArtist))
  ));
  if (candidates.length === 0) {
    const detail = artist ? ` by ${artist}` : '';
    throw new Error(`No playable Spotify track confidently matched ${title}${detail}. Use home_assistant_search_spotify_tracks to review candidates.`);
  }

  return [...candidates].sort((left, right) => (
    Number(normalizeSpotifyText(right.name) === requestedTitle)
    - Number(normalizeSpotifyText(left.name) === requestedTitle)
  ))[0];
}

function normalizedBaseTitle(value: string): string {
  return normalizeSpotifyText(value.split(/\s(?:-|–|—)\s|\s*[([]/u, 1)[0]);
}

function normalizeSpotifyText(value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function mediaPlayerSummary(state: HomeAssistantState): MediaPlayerSummary {
  const attributes = state.attributes || {};
  const supportedFeatures = numberAttribute(attributes, 'supported_features');

  return {
    entity_id: state.entity_id,
    ...optionalString('name', attributes.friendly_name),
    state: state.state,
    available: state.state !== 'unavailable',
    ...optionalString('device_class', attributes.device_class),
    ...optionalNumber('volume_level', attributes.volume_level),
    ...optionalBoolean('is_volume_muted', attributes.is_volume_muted),
    ...optionalString('source', attributes.source),
    ...(isStringArray(attributes.source_list) ? { sources: attributes.source_list } : {}),
    ...optionalString('media_content_type', attributes.media_content_type),
    ...optionalString('media_title', attributes.media_title),
    ...optionalString('media_artist', attributes.media_artist),
    ...optionalString('media_album_name', attributes.media_album_name),
    ...optionalNumber('media_duration_seconds', attributes.media_duration),
    ...optionalNumber('media_position_seconds', attributes.media_position),
    ...optionalString('media_position_updated_at', attributes.media_position_updated_at),
    ...(supportedFeatures === undefined ? {} : { supported_features: supportedFeatures }),
    capabilities: Object.fromEntries(Object.entries(MEDIA_PLAYER_FEATURE).map(([name, flag]) => [
      name,
      supportedFeatures !== undefined && (supportedFeatures & flag) === flag,
    ])) as MediaPlayerSummary['capabilities'],
    ...(state.last_changed ? { last_changed: state.last_changed } : {}),
    ...(state.last_updated ? { last_updated: state.last_updated } : {}),
  };
}

function numberAttribute(attributes: Record<string, unknown>, key: string): number | undefined {
  return typeof attributes[key] === 'number' ? attributes[key] : undefined;
}

function optionalString<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  return typeof value === 'string' ? { [key]: value } as Record<Key, string> : {};
}

function optionalNumber<Key extends string>(key: Key, value: unknown): Partial<Record<Key, number>> {
  return typeof value === 'number' ? { [key]: value } as Record<Key, number> : {};
}

function optionalBoolean<Key extends string>(key: Key, value: unknown): Partial<Record<Key, boolean>> {
  return typeof value === 'boolean' ? { [key]: value } as Record<Key, boolean> : {};
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function assertAvailable(player: MediaPlayerSummary): void {
  if (!player.available) {
    throw new Error(`Media player is unavailable: ${player.entity_id}`);
  }
}

function assertCapability(player: MediaPlayerSummary, capability: keyof MediaPlayerSummary['capabilities']): void {
  if (player.supported_features !== undefined && !player.capabilities[capability]) {
    throw new Error(`Media player ${player.entity_id} does not advertise support for ${capability}`);
  }
}

function isSpotifyPlayer(player: MediaPlayerSummary): boolean {
  return player.entity_id.toLowerCase().includes('spotify')
    || player.name?.toLowerCase().includes('spotify') === true;
}

function spotifySource(player: MediaPlayerSummary): { name: string; select: boolean } {
  if (player.source) {
    return { name: player.source, select: false };
  }

  const sources = player.sources || [];
  const macMini = sources.find((source) => source.toLowerCase().includes('mac mini'));
  if (macMini) {
    return { name: macMini, select: true };
  }
  if (sources.length === 1) {
    return { name: sources[0], select: true };
  }
  if (sources.length === 0) {
    throw new Error(`No connected Spotify source is available on ${player.entity_id}.`);
  }

  throw new Error(`Expected one connected Spotify source on ${player.entity_id}.`);
}
