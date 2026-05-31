---
"@briancray/belte": minor
---

**Breaking:** verb helpers now take `inputSchema` (and optional `outputSchema`) instead of `schema`. `inputSchema` validates incoming args and feeds OpenAPI params / the MCP tool input; `outputSchema` describes the success body for the OpenAPI `200` response and MCP tool output. Client exposure (`browser` / `mcp` / `cli`) now defaults per-surface from the schema — read-only verbs auto-expose to MCP, mutating verbs opt in via `clients`. Migrate by renaming `{ schema }` to `{ inputSchema }`.
