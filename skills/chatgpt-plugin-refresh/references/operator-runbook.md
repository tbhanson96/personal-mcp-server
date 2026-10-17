# Operator runbook

The automation uses a dedicated persistent browser profile. It never imports
another browser's cookies or uses a remote debugging port.

## One-time setup

1. Install the pinned Node dependencies with `npm ci`.
2. Install the Playwright-managed Chromium binary with
   `npx playwright install chromium`. System packages may require an operator
   with appropriate host privileges; do not elevate automatically.
3. From an interactive graphical session, run `npm run chatgpt:refresh:setup`.
4. In the opened browser, sign in manually and complete any CAPTCHA or MFA.
   Open ChatGPT Plugins and confirm the Personal MCP connection is visible,
   then close the browser.
5. Run `npm run chatgpt:refresh:check`.

The default profile is
`~/.config/personal-mcp-server/chatgpt-refresh-profile`. Override it with
`PERSONAL_MCP_CHATGPT_PROFILE_DIR`. Set
`PERSONAL_MCP_CHATGPT_PLUGIN_NAME` when the connection is not named
`Personal MCP`. These variables contain configuration only, never secrets.

## Guarded release invocation

Use the existing deployment command with the explicit opt-in flag:

```sh
deploy/deploy-host.sh <full-commit-sha> --refresh-chatgpt
```

The deploy helper captures the currently running revision's manifest before
the restart, deploys and verifies the requested immutable revision, and invokes
the browser only if the manifests differ. Without the flag it reports the
eligible refresh command but does not open a browser.

Headless operation is not the default. It is allowed only after the dedicated
profile was created interactively and the operator explicitly sets
`PERSONAL_MCP_CHATGPT_HEADLESS=1`. A login, CAPTCHA, MFA, permission prompt, or
confirmation dialog is always a handoff even in headless mode.

## Outcomes

- `refreshed`: ChatGPT showed the changed metadata and all added tool names.
- `skipped_no_tool_changes`: the before/after manifests are identical.
- `handoff_required`: the deployment remains successful, but the reported UI
  step must be completed by the operator.
- `verification_failed`: the UI refresh ran but the expected metadata could
  not be proven. Inspect the private screenshot locally.

After `refreshed`, start a new ChatGPT conversation, select the plugin, and
rerun affected prompts. Existing conversations should be treated as stale.
