# Project Instructions

## Default delivery workflow

- For routine, clearly scoped work in this repository, carry the request through
  investigation, implementation, tests, security checks, commit, push, CI,
  explicit image publication, host deployment, health/feature verification,
  and final reporting. The user should not need to ask separately for each
  routine step.
- Before editing, inspect the worktree and preserve unrelated user changes.
  Before pushing, fetch `origin/main` and do not overwrite upstream work.
- Run `npm test`, `npm run build`, `npm audit --omit=dev`, and
  `git diff --check` before committing.
- After pushing `main`, wait for the `Build` workflow for the exact commit to
  succeed. Then dispatch `Publish image` with the full commit SHA, wait for it
  to publish successfully, and deploy that exact SHA with
  `deploy/deploy-host.sh <full-commit-sha>`.
- Verify the user service, `/health`, the running image revision, and the
  requested feature after deployment. Feature verification must be read-only
  unless the request explicitly authorizes a state change.
- Stop and ask before destructive operations, credential or secret changes,
  irreversible data changes, live Home Assistant mutations, uncertain service
  targets, force pushes, history rewrites, or a deployment whose rollback path
  cannot be identified. Never expose environment-file contents in logs.
- Do not publish or deploy from an uncommitted tree, a failed CI run, or a
  commit other than the exact reviewed `main` commit.

Ordinary pushes run CI but do not publish an image. Image publication is an
explicit release action so documentation or incomplete work cannot
automatically replace production `latest`.

## MCP OAuth scope upgrades

- When an authenticated tool is called without all of its required OAuth
  scopes, return a `CallToolResult` with `isError: true` and
  `_meta["mcp/www_authenticate"]`. The challenge must include the protected
  resource metadata URL, `error="insufficient_scope"`, and the scopes needed
  to preserve the caller's existing grants plus the tool's required grants.
- Do not report an insufficient scope only by throwing a plain MCP protocol
  error or returning text. ChatGPT needs the `mcp/www_authenticate` metadata to
  open its authorization or scope-upgrade UI.
- Keep each tool's `securitySchemes` scopes aligned with runtime enforcement,
  and add an MCP-level test that verifies the complete scope-upgrade challenge.
