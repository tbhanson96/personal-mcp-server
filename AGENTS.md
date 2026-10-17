# Project Instructions

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
