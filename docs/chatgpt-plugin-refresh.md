# ChatGPT plugin metadata refresh

The repository tracks `config/tool-schema-manifest.json`, a deterministic
snapshot of every tool name, title, description, input/output schema,
annotation, metadata field, and OAuth security scheme advertised by
`tools/list`. CI fails when source definitions and the snapshot diverge.

After an exact image passes service, health, and revision checks,
`deploy/deploy-host.sh` reconstructs the prior running revision's manifest and
compares it with the deployed manifest. Browser automation is eligible only
when they differ. It is opt-in with `--refresh-chatgpt`; an ordinary deploy
reports the pending action without opening a browser.

The automation follows the [official OpenAI refresh
flow](https://developers.openai.com/plugins/deploy/connect-chatgpt): open the
custom MCP connection in ChatGPT Plugins, select **Refresh tools**, verify
changed advertised metadata and added tools, then use a new conversation for
affected tests. The official documentation abbreviates this action as
“Refresh”; the current UI button is labeled **Refresh tools**.

## Browser setup

```sh
npm ci
npx playwright install chromium
npm run chatgpt:refresh:check
npm run chatgpt:refresh:probe
```

The refresh runs headlessly and needs no graphical display. Point
`PERSONAL_MCP_CHATGPT_PROFILE_DIR` at a user-controlled Chromium profile that
is already authenticated with ChatGPT; the host default is
`~/.config/chromium`. If no such profile exists, create and authenticate it
manually outside this automation. The automation never reads, exports, or
prints browser storage, and it never attempts login or approval flows.

The probe is read-only: it opens ChatGPT Plugins headlessly and verifies the
configured plugin is visible. It does not click **Refresh tools**.

Override the default profile path with `PERSONAL_MCP_CHATGPT_PROFILE_DIR` and
the connection label with `PERSONAL_MCP_CHATGPT_PLUGIN_NAME`. Headless mode is
the default; `PERSONAL_MCP_CHATGPT_HEADLESS=0` is an explicit headed diagnostic
override. If the profile was created by a separately installed Chrome or
Chromium version, set `PERSONAL_MCP_CHATGPT_EXECUTABLE_PATH` to that browser so
the automation does not open a newer profile with an incompatible bundled
browser. Explicit browsers retain their Chromium sandbox.

The command wrapper loads optional non-secret host settings from
`~/.config/personal-mcp-server/chatgpt-refresh.env`. On a host where headless
mode alone triggers human verification, configure headed mode on a local Xvfb
display. The browser can render there unattended; a VNC connection is useful
for setup and diagnostics but is not required for later refreshes.

Failure reports and screenshots are written with private permissions beneath
`~/.local/state/personal-mcp-server/chatgpt-refresh/`. They contain only schema
hashes, affected tool names, outcome, and a local screenshot; they are not
uploaded. Login, CAPTCHA, MFA, permission prompts, confirmation dialogs, and
schema details not exposed by the UI produce an actionable handoff.

The script does not start or mutate conversations. After a successful refresh,
start a new conversation, select Personal MCP, and rerun the affected prompts.
Treat existing conversations as having the old tool snapshot.
