import { createMcpServer } from 'belte/mcp/createMcpServer'

/*
Optional MCP customisation. Belte mounts `POST /__belte/mcp` zero-config —
this file just lets you override the server identity and add an
`authorize` hook. The default behaviour (no `src/server/mcp.ts`) reads
`name` and `version` from package.json and skips authorization.

The `authorize` hook runs once per JSON-RPC envelope before any tool
or resource dispatch. Throw `new HttpError(401, ...)` from
`belte/server/HttpError` to reject — it's left disabled here so the
kitchen-sink demo at /mcp can call tools without a bearer token.
*/
export default createMcpServer({
    name: 'kitchen-sink',
    version: '0.0.1',
})
