# Personal MCP Server

MCP server for local personal services: Vikunja, Mealie, homeserver, and Home Assistant.

This project intentionally starts with read-only tools. Write tools should be added with explicit MCP annotations and service-level allowlists.

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

## Tools

- `home_assistant_get_config`
- `home_assistant_get_states`
- `home_assistant_get_state`
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
