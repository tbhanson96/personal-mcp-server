# Spotify playback through Home Assistant

The Personal MCP server exposes five media-player tools:

- `home_assistant_get_media_players` returns sanitized playback state,
  supported actions, and source names. It can list every player or inspect one
  exact `media_player.*` entity.
- `home_assistant_search_spotify_tracks` searches the Spotify catalog through
  the server-side SpotifyPlus Home Assistant integration and returns sanitized
  candidates with exact track URIs.
- `home_assistant_play_spotify_track` searches and plays a confidently matched
  named track.
- `home_assistant_play_spotify` resolves the single Spotify player and its
  connected source, then plays an exact track, album, playlist, or episode URI.
- `home_assistant_control_media_player` performs one bounded action: pause,
  resume, next, previous, seek, or set volume.

## Named-song workflow

For a request such as “Play Moves Like Jagger by Maroon 5 in the living room”:

1. Call `home_assistant_play_spotify_track` with `title` and `artist`. The server
   searches `spotifyplus.search_tracks`, requires a playable title/artist
   match, and plays the best match using the exact returned Spotify URI.
2. For requests that name a remix, live recording, radio edit, or otherwise
   ambiguous version, call `home_assistant_search_spotify_tracks`, let the user
   choose when necessary, then call `home_assistant_play_spotify` with the
   selected exact URI.
3. Use `home_assistant_get_media_players` afterward if playback state needs to be
   confirmed.

Named-track example:

```json
{
  "title": "Moves Like Jagger",
  "artist": "Maroon 5"
}
```

Exact-URI example after explicit disambiguation:

```json
{
  "spotify_uri": "spotify:track:<id returned by Spotify search>"
}
```

## Security and authentication

- The MCP HTTP endpoint still requires its API key or OAuth bearer token.
- Read-only media-player discovery requires the `mcp:read` OAuth scope.
- Playback and control tools require `mcp:control`. A read-only call returns an
  OAuth scope-upgrade challenge so compatible clients can open reauthorization;
  otherwise reconnect manually and authorize the new scope.
- `HOME_ASSISTANT_TOKEN` stays in the Personal MCP server environment. It is
  sent only to the configured `HOME_ASSISTANT_URL` as a bearer token.
- Tool schemas accept no Home Assistant or Spotify credentials.
- Search output is allowlisted to track name, artists, album, URI, duration,
  explicit flag, and playability. SpotifyPlus user-profile and raw API fields
  are never returned.
- Playback writes are allowlisted to six `media_player` services plus
  `select_source` and `play_media`. Spotify URI forms, volume, seek position,
  and action names are validated before any network request.
- State results use an attribute allowlist. Home Assistant attributes such as
  entity-picture proxy URLs or tokens are not returned by the semantic media
  tools.

Use a dedicated Home Assistant user/token with only the permissions needed for
the intended media-player entities when the Home Assistant installation and
version support sufficiently granular user permissions.

## Home Assistant mapping

| MCP action | Home Assistant service | Extra data |
| --- | --- | --- |
| pause | `media_player.media_pause` | none |
| resume | `media_player.media_play` | none |
| next | `media_player.media_next_track` | none |
| previous | `media_player.media_previous_track` | none |
| seek | `media_player.media_seek` | `seek_position` in seconds |
| set_volume | `media_player.volume_set` | `volume_level` from 0 to 1 |

Named-track resolution calls `spotifyplus.search_tracks` with
`return_response`, using the resolved Spotify media-player entity as the
server-side SpotifyPlus account. Spotify playback optionally calls
`media_player.select_source` and then calls
`media_player.play_media`, deriving `media_content_type` from the validated
Spotify URI. It keeps the current source when one is connected; otherwise it
prefers a source containing “Mac mini,” then a sole available source.

## Limitations

- Named-track search requires the configured Home Assistant Spotify player to
  be backed by SpotifyPlus and for that integration's authorization to remain
  valid. Exact URI playback remains available independently.
- The Spotify integration can select only devices currently known to the
  Spotify API. A speaker that is asleep, unavailable, or absent from `sources`
  cannot be selected by this server.
- The implementation assumes exactly one Home Assistant Spotify player and one
  connected Spotify device. It fails safely instead of asking for a selection
  if that invariant is ever violated.
- Home Assistant remains the final authority and may reject an action that its
  Spotify player cannot perform.
- Speaker power is a separate Home Assistant concern. An unavailable
  `media_player.*` speaker does not mean a corresponding `switch.*` power
  entity is unavailable. When the request includes power, resolve and operate
  that switch separately; the current home also has an automation that powers
  speakers when Spotify begins playback.
- Seek support and current position are integration-dependent. Position state
  can be slightly stale between Home Assistant updates.
- Source selection and playback are two sequential Home Assistant calls, not
  one atomic operation. If source selection succeeds and playback fails, the
  selected source can remain changed.
- The tools acknowledge accepted Home Assistant service calls; use the read
  tool afterward when confirmation of resulting state matters.

Official references: [Home Assistant Spotify integration](https://www.home-assistant.io/integrations/spotify/),
[media player integration actions](https://www.home-assistant.io/integrations/media_player/),
and the [Home Assistant REST API](https://developers.home-assistant.io/docs/api/rest/).
