import type { RemoteRoutes } from '../server/rpc/types/RemoteRoutes.ts'
import type { SocketRoutes } from '../server/sockets/types/SocketRoutes.ts'

/*
Process-wide slot for the rpc + sockets manifests. createServer assigns
once at boot (right after the route table is built); the MCP server
reads on first request so it can lazy-import every module and walk the
verb/socket registries to build tool/resource descriptors.

The slot pattern (mirrors getActiveServer) lets users construct an
McpServer at module scope in `src/server/mcp.ts` while still binding to
the framework manifests that aren't accessible to user code.
*/
type McpManifests = {
    rpc: RemoteRoutes
    sockets: SocketRoutes
}

let manifests: McpManifests | undefined
let loadedAll = false

export function setMcpManifests(value: McpManifests): void {
    manifests = value
    loadedAll = false
}

export function getMcpManifests(): McpManifests | undefined {
    return manifests
}

/*
On first call, eagerly imports every rpc + socket module so defineVerb /
defineSocket fire and populate the registries. Idempotent — repeat calls
are no-ops. Eager loading is acceptable here because MCP enumeration
fundamentally requires the full surface (clients can ask for any tool
at any time); the alternative of per-tool lazy loading produces flaky
first-call latency.
*/
export async function ensureMcpRegistriesLoaded(): Promise<void> {
    if (loadedAll || !manifests) {
        return
    }
    await Promise.all([
        ...Object.values(manifests.rpc).map((loader) => loader()),
        ...Object.values(manifests.sockets).map((loader) => loader()),
    ])
    loadedAll = true
}
