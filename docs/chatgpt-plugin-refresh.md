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
custom MCP connection in ChatGPT Plugins, select **Refresh**, verify changed
advertised metadata and added tools, then use a new conversation for affected
tests.

## Browser setup

```sh
npm ci
npx playwright install chromium
npm run chatgpt:refresh:setup
npm run chatgpt:refresh:check
```

Run setup from an interactive graphical session. It opens a dedicated profile
at `~/.config/personal-mcp-server/chatgpt-refresh-profile`; sign in and complete
CAPTCHA or MFA yourself, verify the Personal MCP plugin is visible, and close
the browser. The automation never reads, exports, or prints browser storage,
and it never attempts login or approval flows. Do not point it at a normal
daily-use browser profile.

Override the dedicated path with `PERSONAL_MCP_CHATGPT_PROFILE_DIR` and the
connection label with `PERSONAL_MCP_CHATGPT_PLUGIN_NAME`. Headless mode is only
available after interactive setup and requires the explicit
`PERSONAL_MCP_CHATGPT_HEADLESS=1` opt-in.

Failure reports and screenshots are written with private permissions beneath
`~/.local/state/personal-mcp-server/chatgpt-refresh/`. They contain only schema
hashes, affected tool names, outcome, and a local screenshot; they are not
uploaded. Login, CAPTCHA, MFA, permission prompts, confirmation dialogs, and
schema details not exposed by the UI produce an actionable handoff.

The script does not start or mutate conversations. After a successful refresh,
start a new conversation, select Personal MCP, and rerun the affected prompts.
Treat existing conversations as having the old tool snapshot.
