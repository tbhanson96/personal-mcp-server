# Operator runbook

The automation uses the host user's persistent Chromium profile. It never
exports cookies or uses a remote debugging port.

## One-time setup

1. Install the pinned Node dependencies with `npm ci`.
2. Install the Playwright-managed Chromium binary with
   `npx playwright install chromium`. System packages may require an operator
   with appropriate host privileges; do not elevate automatically.
3. Point `PERSONAL_MCP_CHATGPT_PROFILE_DIR` at a user-controlled Chromium
   profile that is already authenticated with ChatGPT.
4. Run `npm run chatgpt:refresh:check`.
5. Run `npm run chatgpt:refresh:probe` to verify authentication and Personal
   MCP visibility without clicking **Refresh tools**.

The refresh runs headlessly by default. If a host explicitly uses headed mode
to avoid a headless-only verification challenge, run it on a local virtual
display; connecting a VNC viewer is optional. If no authenticated profile
exists, create it manually outside this automation. The optional
`npm run chatgpt:refresh:setup` command is a headed bootstrap helper only; it is
not part of normal deployment or refresh execution.

The default profile is the host user's existing Chromium profile at
`~/.config/chromium`. Override it with
`PERSONAL_MCP_CHATGPT_PROFILE_DIR`. Set
`PERSONAL_MCP_CHATGPT_PLUGIN_NAME` when the connection is not named
`Personal MCP`. These variables contain configuration only, never secrets.

Keep the browser executable compatible with the browser that created the
profile. Set `PERSONAL_MCP_CHATGPT_EXECUTABLE_PATH` to an operator-installed
Chromium or Chrome executable when the profile was created by that browser.
An explicitly configured browser launches with its Chromium sandbox enabled;
do not disable the sandbox to work around host policy.

The wrapper reads optional, non-secret host configuration from
`~/.config/personal-mcp-server/chatgpt-refresh.env`. It accepts only
`PERSONAL_MCP_CHATGPT_PROFILE_DIR`,
`PERSONAL_MCP_CHATGPT_EXECUTABLE_PATH`,
`PERSONAL_MCP_CHATGPT_PLUGIN_NAME`, `PERSONAL_MCP_CHATGPT_HEADLESS`, and
`DISPLAY`. Existing environment variables take precedence over the file.
For persistent headed operation, install
`assets/chatgpt-virtual-display.service` as a user service and enable it. The
service provides only an in-memory X display; it does not install or start a
desktop environment. A separately started, loopback-only VNC server may attach
for diagnostics but is not part of unattended operation.

## Guarded release invocation

Use the existing deployment command with the explicit opt-in flag:

```sh
deploy/deploy-host.sh <full-commit-sha> --refresh-chatgpt
```

The deploy helper captures the currently running revision's manifest before
the restart, deploys and verifies the requested immutable revision, and invokes
the browser only if the manifests differ. Without the flag it reports the
eligible refresh command but does not open a browser.

Headless operation is the portable default. A host may set
`PERSONAL_MCP_CHATGPT_HEADLESS=0` and use Xvfb for unattended headed operation
when headless mode alone triggers verification. No VNC client needs to be
connected. A login, CAPTCHA, MFA, permission prompt, or confirmation dialog is
always a handoff.

## Outcomes

- `refreshed`: ChatGPT showed the changed metadata and all added tool names.
- `skipped_no_tool_changes`: the before/after manifests are identical.
- `handoff_required`: the deployment remains successful, but the reported UI
  step must be completed by the operator.
- `verification_failed`: the UI refresh ran but the expected metadata could
  not be proven. Inspect the private screenshot locally.

After `refreshed`, start a new ChatGPT conversation, select the plugin, and
rerun affected prompts. Existing conversations should be treated as stale.
