---
name: chatgpt-plugin-refresh
description: Refresh a directly connected ChatGPT custom MCP plugin after a verified personal-mcp-server deployment when advertised tool metadata changed. Use for guarded release completion or a pending Personal MCP metadata refresh; do not use for published-plugin review or permission changes.
---

# Refresh the ChatGPT Personal MCP plugin

Use the repository's checked-in `config/tool-schema-manifest.json` as the
advertised-metadata boundary. The refresh is eligible only after the exact
deployed revision, service, and health endpoint have been verified and the
before/after manifests differ. A pending refresh may be retried against the
same verified deployment.

Run `npm run chatgpt:refresh:check` before browser work. Use the
user-controlled persistent Chromium profile documented in
[references/operator-runbook.md](references/operator-runbook.md). Do not read,
copy, print, export, or serialize cookies, passwords, tokens, profile contents,
or browser storage. Do not automate login, CAPTCHA, MFA, risk acceptance,
permission changes, or confirmation dialogs. If any appear, stop and give the
operator the exact next UI action.

For an eligible refresh, use
`scripts/refresh-chatgpt-plugin.mjs --before-manifest <path> --after-manifest <path>`.
The script uses a Playwright persistent Chromium context, semantic locators,
and a local failure screenshot. Headless is the portable default, but a host
where headless mode triggers verification may explicitly use a headed browser
on a local virtual display. A VNC viewer is optional and is never required for
unattended runs. It only visits
`https://chatgpt.com/plugins`, opens the configured plugin connection, and
selects **Refresh tools**. Do not replace this with hidden APIs, copied network
requests, remote-debugging attachment, or undocumented endpoints.

Treat the refresh as complete only when the script verifies changed advertised
metadata and every newly added tool name in ChatGPT. If the UI does not expose
enough detail to verify a schema-only change, report it as requiring manual
confirmation. Always report that existing conversations retain their prior
tool snapshot and the affected tests must run in a new conversation, following
[official OpenAI documentation](https://developers.openai.com/plugins/deploy/connect-chatgpt).

Store evidence only in the private local artifact directory: manifest hashes,
changed/added/removed tool names, outcome, and failure screenshot path. Never
store page text, request headers, storage state, or credentials.
