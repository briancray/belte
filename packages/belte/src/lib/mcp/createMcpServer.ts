import { dispatchMcpRequest, MCP_NO_STORE_HEADERS } from './dispatchMcpRequest.ts'
import type { McpServer } from './types/McpServer.ts'
import type { McpServerOptions } from './types/McpServerOptions.ts'

const DEFAULT_NAME = 'belte-app'
const DEFAULT_VERSION = '0.0.0'

/*
Constructs an MCP server bound to the project's rpc + socket registries.
Returns an object whose `handle(request)` is the function the bun route
at /__belte/mcp invokes. Users can call this from src/server/mcp.ts to
customise behaviour (currently: authorize hook, server name/version);
absent that, the framework constructs a default server with the project
name from package.json.

Tools are derived from every verb with `clients.mcp: true` and every
socket with `clients.mcp: true` (await_<name> + optional publish_<name>).
Resources are derived from sockets with `clients.mcp: true`. Auth
inherits from the inbound request — bearer / cookie headers flow into
the synthesized Request that hits each rpc handler. An optional
`authorize` hook in opts can short-circuit the request before any tool
dispatches.
*/
export function createMcpServer(opts: McpServerOptions = {}): McpServer {
    const serverInfo = {
        name: opts.name ?? DEFAULT_NAME,
        version: opts.version ?? DEFAULT_VERSION,
    }
    return {
        async handle(request: Request): Promise<Response> {
            if (request.method !== 'POST') {
                return new Response('Method Not Allowed', {
                    status: 405,
                    headers: { Allow: 'POST', 'Cache-Control': 'no-store' },
                })
            }
            const envelope = await dispatchMcpRequest(request, opts, serverInfo)
            return new Response(JSON.stringify(envelope), { headers: MCP_NO_STORE_HEADERS })
        },
    }
}
