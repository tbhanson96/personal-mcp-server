# Personal MCP Server

MCP server for local personal services: Vikunja, Mealie, homeserver, and Home Assistant.

It can also control the host Happy daemon through a restricted Unix-socket
bridge. The container never receives `~/.happy`, Happy credentials, the Docker
socket, or host process access.

State-changing tools are bounded semantic operations with explicit MCP annotations and service-level allowlists; the server does not expose raw service-call tools.

## Development

```sh
npm install
npm run build
npm test
PERSONAL_MCP_API_KEY=dev npm run dev
```

The HTTP MCP endpoint is:

```text
POST /mcp
```

Authenticate with either:

```text
Authorization: Bearer <PERSONAL_MCP_API_KEY>
```

or:

```text
x-api-key: <PERSONAL_MCP_API_KEY>
```

OAuth advertises `mcp:read` and `mcp:control` separately. Home Assistant
mutations such as thermostat and playback control require `mcp:control`;
read-only discovery requires `mcp:read`. The
server returns an OAuth scope-upgrade challenge when a read-only connection
calls a control tool. The server API key grants both scopes. Home Assistant
credentials remain in the server environment and are never accepted as tool
arguments.

## Deployment

Copy the example env files into `~/.config/personal-mcp-server/`, fill in secrets, then copy or symlink the service unit:

```sh
mkdir -p ~/.config/personal-mcp-server ~/.config/systemd/user
cp deploy/env/personal-mcp-server.service.env.example ~/.config/personal-mcp-server/personal-mcp-server.service.env
cp deploy/env/personal-mcp-server.container.env.example ~/.config/personal-mcp-server/personal-mcp-server.container.env
cp deploy/systemd/personal-mcp-server.service ~/.config/systemd/user/personal-mcp-server.service
systemctl --user daemon-reload
systemctl --user enable --now personal-mcp-server.service
```

Routine pushes run CI only. To release, dispatch the `Publish image` workflow
with the full reviewed `main` commit SHA. After it succeeds, deploy the exact,
revision-labelled image on the host:

```sh
deploy/deploy-host.sh <full-commit-sha>
```

The deploy helper validates and installs the tracked systemd unit, pulls the
immutable `sha-<commit>` image, restarts the service, checks `/health`, verifies
the running OCI revision, and attempts to restore the previous image digest if
verification fails. It never invokes an MCP state-changing tool.

## Tools

- `home_assistant_get_config`
- `home_assistant_get_states`
- `home_assistant_get_state`
- `home_assistant_control_entity`
- `home_assistant_set_temperature`
- `home_assistant_get_media_players`
- `home_assistant_play_spotify`
- `home_assistant_control_media_player`
- `homeserver_list_files`
- `homeserver_list_ebooks`
- `homeserver_search_ebooks`
- `homeserver_get_health_catalog`
- `homeserver_query_health_metric`
- `homeserver_get_health_statistics`
- `homeserver_get_health_daily_summary`
- `homeserver_get_sleep_data`
- `mealie_search_recipes`
- `mealie_get_recipe`
- `vikunja_list_projects`
- `vikunja_list_tasks`
- `happy_daemon_status`
- `happy_list_sessions`
- `happy_start_codex_session`
- `happy_send_prompt`
- `happy_get_session_messages`
- `happy_start_and_prompt`
- `happy_stop_session`

See [Spotify playback through Home Assistant](docs/spotify-playback.md) for the
tool workflow, security model, supported actions, and device limitations.
See [Thermostat control through Home Assistant](docs/thermostat-control.md) for
setpoint validation, authorization, and safe testing guidance.

## Happy bridge

Build the project, install `deploy/systemd/personal-mcp-happy-bridge.service`
as a user service, and configure it with
`deploy/env/happy-bridge.env.example`. The Personal MCP container receives only
a read-only bind mount of the bridge's Unix-socket directory. The bridge:

- accepts only structured Happy status, list, start, prompt, message-read, and stop requests;
- restricts working directories to `HAPPY_BRIDGE_ALLOWED_ROOTS`;
- reports those host roots through `happy_daemon_status` so callers do not confuse
  them with paths returned by homeserver file APIs;
- starts every managed Codex session and prompt in `yolo` permission mode;
- never exposes Happy access tokens or session encryption keys to the container;
- decrypts known-session messages on the host and returns bounded, cursor-paginated results;
- refuses state-changing operations when the Happy CLI version differs from
  `HAPPY_BRIDGE_SUPPORTED_VERSION`.
