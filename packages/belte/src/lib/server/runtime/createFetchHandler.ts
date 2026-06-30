import type { Server } from 'bun'
import type { McpServer } from '../../mcp/types/McpServer.ts'
import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { CLI_PATH } from '../../shared/CLI_PATH.ts'
import { logClosingRecord } from '../../shared/logClosingRecord.ts'
import { RESOLVE_STREAM_PATH } from '../../shared/RESOLVE_STREAM_PATH.ts'
import { SOCKETS_PATH } from '../../shared/SOCKETS_PATH.ts'
import { handleCliDownload } from '../cli/handleCliDownload.ts'
import { handleCliInstall } from '../cli/handleCliInstall.ts'
import type { createSocketDispatcher } from '../sockets/createSocketDispatcher.ts'
import { buildOpenApiSpec } from './buildOpenApiSpec.ts'
import type { createAppAssetServer } from './createAppAssetServer.ts'
import type { createPageRenderer } from './createPageRenderer.ts'
import type { createProbingEndpoints } from './createProbingEndpoints.ts'
import type { createPublicAssetServer } from './createPublicAssetServer.ts'
import { crossOriginGate } from './crossOriginGate.ts'
import { ensureRegistriesLoaded } from './registryManifests.ts'
import { resolveStreamResponse } from './resolveStreamResponse.ts'
import type { DispatchRequest } from './types/DispatchRequest.ts'

const SOCKETS_HTTP_PREFIX = `${SOCKETS_PATH}/`
const MCP_PATH = '/__belte/mcp'
const CLI_DOWNLOAD_PREFIX = `${CLI_PATH}/`
/*
Unlike the framework's own plumbing routes above (the socket multiplex, MCP
endpoint, CLI download), the OpenAPI document describes the app's public HTTP
surface — the /rpc/* rpcs — rather than belte internals, so it sits at the
conventional root path where external tooling and scanners expect to find it
(/openapi.json, alongside /swagger.json, /.well-known/*) rather than under the
/__belte/ namespace.
*/
const OPENAPI_PATH = '/openapi.json'

/*
Bun.serve's `fetch` for everything the `routes` table doesn't claim: the
framework's probe/operator surface (delegated to probingEndpoints), the socket
upgrade + HTTP face, the out-of-band resolution stream, MCP, the CLI
install/download, the OpenAPI doc, static `/_app/` and public assets, and the
404 fallthrough. Dynamic paths run through dispatchRequest so app.handle
middleware and the request scope apply; assets and the resolution stream
deliberately sidestep it.

A pure move out of createServer; boot-time collaborators (asset servers, the
page error renderer, the socket dispatcher, identity fields) are captured once
and the returned function carries only Bun's per-request (req, bunServer).
openApiSpec is built on first request then reused — closed over here so it
survives across calls, matching the original mutable boot-scope binding.
*/
export function createFetchHandler({
    probingEndpoints,
    dispatchRequest,
    socketDispatcher,
    servePublicAsset,
    serveAppAsset,
    renderError,
    mcp,
    cliName,
    cliCwd,
    appName,
    appVersion,
    logRequests,
}: {
    probingEndpoints: ReturnType<typeof createProbingEndpoints>
    dispatchRequest: DispatchRequest
    socketDispatcher: ReturnType<typeof createSocketDispatcher>
    servePublicAsset: Awaited<ReturnType<typeof createPublicAssetServer>>
    serveAppAsset: Awaited<ReturnType<typeof createAppAssetServer>>
    renderError: ReturnType<typeof createPageRenderer>['renderError']
    mcp?: McpServer
    cliName: string
    cliCwd: string
    appName: string
    appVersion: string
    logRequests: boolean
}): (req: Request, bunServer: Server<unknown>) => Promise<Response> {
    /* Built on first request, then reused — the rpc registry is frozen after load. */
    let openApiSpec: ReturnType<typeof buildOpenApiSpec> | undefined
    return async function fetch(req, bunServer) {
        const url = new URL(req.url)
        /* Framework probe/operator surface, answered ahead of app.handle; undefined falls through. */
        const probed = await probingEndpoints(req, url, bunServer)
        if (probed) {
            return probed
        }
        if (url.pathname === SOCKETS_PATH) {
            // Reject cross-origin upgrades (CSWSH) before handing off to Bun.
            const upgradeForbidden = crossOriginGate(req, url)
            if (upgradeForbidden) {
                return upgradeForbidden
            }
            if (bunServer.upgrade(req, { data: {} })) {
                return undefined as unknown as Response
            }
            return new Response('Upgrade failed', { status: 400 })
        }
        /*
        HTTP face of a socket (`/__belte/sockets/<name>`) — tail over
        SSE / JSON and publish — for the CLI and MCP. Runs through
        dispatchRequest so app.handle auth applies, like the rpc paths.
        The socket name may contain `/` (nested files), so it's the
        whole remaining pathname, percent-decoded.
        */
        if (url.pathname.startsWith(SOCKETS_HTTP_PREFIX)) {
            /*
            Gate cross-origin browser publishes (CSRF, see crossOriginGate).
            GET tail reads stay open cross-origin like rpc reads; only
            the mutating POST is gated.
            */
            const publishForbidden = crossOriginGate(req, url, { allowReadOnly: true })
            if (publishForbidden) {
                return publishForbidden
            }
            const name = decodeURIComponent(url.pathname.slice(SOCKETS_HTTP_PREFIX.length))
            return dispatchRequest(req, {}, async () => socketDispatcher.http(req, name), url)
        }
        /*
        Out-of-band resolution stream for a streamed page's pending
        {#await} reads. Answered directly (no app.handle / request scope):
        it drains promises stashed during SSR, and the random single-use
        token gates access. Returning here bypasses
        disableIdleTimeoutForStream so it inherits the bounded idleTimeout
        rather than the long-lived-stream disable.
        */
        if (url.pathname.startsWith(RESOLVE_STREAM_PATH)) {
            return resolveStreamResponse(url.pathname.slice(RESOLVE_STREAM_PATH.length))
        }
        if (url.pathname === MCP_PATH && mcp) {
            // Gate cross-site browser posts (CSRF, see crossOriginGate).
            const mcpForbidden = crossOriginGate(req, url)
            if (mcpForbidden) {
                return mcpForbidden
            }
            return dispatchRequest(req, {}, async () => mcp.handle(req), url)
        }
        if (url.pathname === CLI_PATH) {
            return dispatchRequest(req, {}, async () => handleCliInstall(req, cliName), url)
        }
        if (url.pathname.startsWith(CLI_DOWNLOAD_PREFIX)) {
            const platform = url.pathname.slice(CLI_DOWNLOAD_PREFIX.length)
            return dispatchRequest(
                req,
                {},
                async () => handleCliDownload(req, platform, cliName, cliCwd),
                url,
            )
        }
        if (url.pathname === OPENAPI_PATH) {
            return dispatchRequest(
                req,
                {},
                async () => {
                    if (!openApiSpec) {
                        await ensureRegistriesLoaded()
                        openApiSpec = buildOpenApiSpec({
                            title: appName,
                            version: appVersion,
                        })
                    }
                    return Response.json(openApiSpec, {
                        headers: { 'Cache-Control': NO_STORE },
                    })
                },
                url,
            )
        }
        /*
        Static assets sidestep ALS + the per-request CacheStore + the
        app.handle middleware: they have no need for cache() and the
        allocation overhead matters on a cold page load that pulls
        dozens of chunks. The global server.error() handler still
        catches anything that goes wrong inside serveAppAsset.
        */
        if (url.pathname.startsWith('/_app/')) {
            if (!logRequests) {
                return serveAppAsset(req, url)
            }
            const start = Bun.nanoseconds()
            const response = await serveAppAsset(req, url)
            const ms = (Bun.nanoseconds() - start) / 1e6
            logClosingRecord(req.method, `${url.pathname}${url.search}`, response.status, ms)
            return response
        }
        /*
        Files under public/ are served at the site root, sidestepping
        ALS + middleware like the /_app/ assets do. A miss returns
        undefined so the request falls through to the 404 / middleware
        path below.
        */
        const publicStart = Bun.nanoseconds()
        const publicResponse = await servePublicAsset(req, url)
        if (publicResponse) {
            if (logRequests) {
                logClosingRecord(
                    req.method,
                    `${url.pathname}${url.search}`,
                    publicResponse.status,
                    (Bun.nanoseconds() - publicStart) / 1e6,
                )
            }
            return publicResponse
        }
        /*
        Unknown routes still run through dispatchRequest so user-defined
        app.handle middleware can rewrite the request, serve a custom
        404, or branch on the URL. The inner handler returns the
        framework's default 404 when nothing intervenes.
        */
        return dispatchRequest(
            req,
            {},
            async (_req, _pathParams, store) => {
                return (
                    (await renderError(404, 'Not Found', store)) ??
                    new Response('Not Found', {
                        status: 404,
                        headers: { 'Cache-Control': NO_STORE },
                    })
                )
            },
            url,
        )
    }
}
