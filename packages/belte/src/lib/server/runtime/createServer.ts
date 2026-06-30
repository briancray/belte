import type { Server } from 'bun'
import type { Errors } from '../../browser/types/Errors.ts'
import type { Layouts } from '../../browser/types/Layouts.ts'
import type { Pages } from '../../browser/types/Pages.ts'
import { createMcpResourceServer } from '../../mcp/createMcpResourceServer.ts'
import { setMcpResourceServer } from '../../mcp/mcpResourceServerSlot.ts'
import type { McpServer } from '../../mcp/types/McpServer.ts'
import { basePathFromAppUrl } from '../../shared/basePathFromAppUrl.ts'
import { belteLog } from '../../shared/belteLog.ts'
import { createViewResolver } from '../../shared/createViewResolver.ts'
import { extraForwardHeaders } from '../../shared/extraForwardHeaders.ts'
import { healthReadSlot } from '../../shared/healthReadSlot.ts'
import { isDebugNegated } from '../../shared/isDebugNegated.ts'
import { OFFLINE_HEADER } from '../../shared/OFFLINE_HEADER.ts'
import { parseBoundedEnvInt } from '../../shared/parseBoundedEnvInt.ts'
import { setAppName } from '../../shared/setAppName.ts'
import { setBaseResolver } from '../../shared/setBaseResolver.ts'
import { setRequestScopeResolver } from '../../shared/setRequestScopeResolver.ts'
import type { AppModule } from '../AppModule.ts'
import type { PromptRoutes } from '../prompts/types/PromptRoutes.ts'
import type { RemoteRoutes } from '../rpc/types/RemoteRoutes.ts'
import { createSocketDispatcher } from '../sockets/createSocketDispatcher.ts'
import type { SocketRoutes } from '../sockets/types/SocketRoutes.ts'
import { buildHealthPayload } from './buildHealthPayload.ts'
import { createAppAssetServer } from './createAppAssetServer.ts'
import { createFetchHandler } from './createFetchHandler.ts'
import { createPageRenderer } from './createPageRenderer.ts'
import { createProbingEndpoints } from './createProbingEndpoints.ts'
import { createPublicAssetServer } from './createPublicAssetServer.ts'
import { createRouteDispatcher } from './createRouteDispatcher.ts'
import { createRouteRegistry } from './createRouteRegistry.ts'
import { createWebsocketHandler } from './createWebsocketHandler.ts'
import { DEFAULT_PORT } from './DEFAULT_PORT.ts'
import { DEV_READY_MESSAGE } from './DEV_READY_MESSAGE.ts'
import { DEV_RELOAD_CLIENT_SCRIPT } from './DEV_RELOAD_CLIENT_SCRIPT.ts'
import { devClientFingerprint } from './devClientFingerprint.ts'
import { disableIdleTimeoutForStream } from './disableIdleTimeoutForStream.ts'
import { internalErrorResponse } from './internalErrorResponse.ts'
import { listenOnOpenPort } from './listenOnOpenPort.ts'
import { logExposedSurfaces } from './logExposedSurfaces.ts'
import { maybeMountInspector } from './maybeMountInspector.ts'
import { parseIdleTimeout } from './parseIdleTimeout.ts'
import { parsePort } from './parsePort.ts'
import { setRegistryManifests } from './registryManifests.ts'
import { requestContext } from './requestContext.ts'
import { runWithRequestScope } from './runWithRequestScope.ts'
import { setActiveServer } from './setActiveServer.ts'
import type { Assets } from './types/Assets.ts'
import type { DispatchRequest } from './types/DispatchRequest.ts'
import { warnUnguardedMcp } from './warnUnguardedMcp.ts'

/*
Starts a Bun HTTP server that ties together the framework conventions:
page.svelte + layout.svelte under src/browser/pages/ for views, one named export
per file under src/server/rpc/ for rpc-bound remote functions, one named export
per file under src/server/sockets/ for broadcast sockets, and an optional
app.ts for boot-time setup, request middleware, and error fallback. Page
URLs and rpc URLs live in disjoint spaces — pages mount at the folder
path, rpc files mount at `/rpc/<file path>` — so each registered URL
resolves to exactly one thing. Per request, an AsyncLocalStorage
RequestStore carries the cache store and request metadata.
*/
export async function createServer({
    pages,
    rpc,
    sockets,
    prompts,
    layouts,
    errors,
    shell,
    app,
    assets,
    publicAssets,
    mcpResources,
    mcp,
    cliProgramName,
    appInfo,
    distDir = `${process.cwd()}/dist`,
    publicDir = `${process.cwd()}/src/browser/public`,
    resourcesDir = `${process.cwd()}/src/mcp/resources`,
    // A configured PORT is honored as-is; left undefined, the real listener
    // scans upward from 3000 at bind time (see buildServer / listenOnOpenPort).
    port = parsePort(process.env.PORT),
    /*
    Bun's per-connection idle timeout in seconds (its own default is 10).
    Surfaced for apps whose unary handlers legitimately compute longer than
    that; streaming responses opt out per-request via disableIdleTimeoutForStream
    regardless of this floor.
    */
    idleTimeout = parseIdleTimeout(process.env.BELTE_IDLE_TIMEOUT) ?? 10,
    /*
    Bun's server-wide request body ceiling, enforced natively by Bun.serve
    (its own default is ~128MB). Surfaced as an option + env so deployments
    can raise/lower it; per-rpc tightening is the rpcs' maxBodySize.
    */
    maxRequestBodySize = parseBoundedEnvInt(
        process.env.BELTE_MAX_REQUEST_BODY_SIZE,
        0,
        Number.MAX_SAFE_INTEGER,
    ),
    // Under `belte dev` the orchestrator sets this: mount the live-reload SSE
    // channel and inject its client into the served shell.
    dev = false,
}: {
    pages: Pages
    rpc: RemoteRoutes
    sockets: SocketRoutes
    prompts: PromptRoutes
    layouts?: Layouts
    errors?: Errors
    shell: string
    app?: AppModule
    assets?: Assets
    publicAssets?: Assets
    mcpResources?: Assets
    mcp?: McpServer
    cliProgramName?: string
    appInfo?: { name: string; version: string }
    distDir?: string
    publicDir?: string
    resourcesDir?: string
    port?: number
    idleTimeout?: number
    maxRequestBodySize?: number
    dev?: boolean
}): Promise<Server<unknown>> {
    /*
    Publish the ALS request scope to the shared layer: trace() and log line
    prefixes resolve through this. Registered here (not serverEntry) so the
    HTTP test harness gets the same behaviour as a real boot. elapsedMs is
    computed at read time so every log line carries a current value.
    */
    setRequestScopeResolver(() => {
        const store = requestContext.getStore()
        if (!store) {
            return undefined
        }
        return {
            trace: store.trace,
            elapsedMs: (Bun.nanoseconds() - store.start) / 1e6,
            method: store.req.method,
            path: store.url.pathname,
            /* The calling client's reported connectivity — drives server-side online(). Absent header = online. */
            online: !store.req.headers.has(OFFLINE_HEADER),
        }
    })
    /*
    health() during an SSR render marks its request through this slot; the
    renderer stamps the health payload into __SSR__ only for marked requests,
    so the client seed stays reader-driven like the poll itself.
    */
    healthReadSlot.mark = () => {
        const store = requestContext.getStore()
        if (store) {
            store.healthRead = true
        }
    }
    // In dev, append the live-reload client to the shell so every rendered
    // page reconnects to /__belte/dev and reloads after a restart.
    const devShell = dev ? shell.replace('</body>', `${DEV_RELOAD_CLIENT_SCRIPT}</body>`) : shell
    /*
    Mount base from APP_URL's pathname (e.g. https://foo.com/v2 → /v2). Install
    the server-side resolver so url() prefixes SSR-generated links, and rewrite
    the shell's framework `/_app` entry + css refs to carry the base — relative
    code-split chunks inherit it from the entry's own URL. '' (root mount) is a
    no-op on both. See setBaseResolver / startClient for the client half.
    */
    const base = basePathFromAppUrl(process.env.APP_URL)
    setBaseResolver(() => base)
    // Rebase the shell's rooted `/_app/` entry refs onto the mount base, matching
    // either quote style so a custom app.html using single quotes still rewrites.
    const activeShell = base ? devShell.replace(/(["'])\/_app\//g, `$1${base}/_app/`) : devShell
    /*
    Boot-path disk scans run concurrently — they share no data, and under
    `belte dev` the worker-swap window is bounded by exactly this boot.
    devClientFingerprint (dev only) hashes the browser-visible surface so the
    live-reload channel reloads only when a worker swap changed what the
    browser would render; the asset servers glob public/ and the build tree
    (embedded zstd map in a compiled binary, dist/ on disk).
    */
    const [clientFingerprint, servePublicAsset, serveAppAsset] = await Promise.all([
        dev ? devClientFingerprint({ distDir, publicDir, shell: activeShell }) : undefined,
        createPublicAssetServer({ publicDir, publicAssets }),
        createAppAssetServer({ distDir, assets }),
    ])
    setRegistryManifests({ rpc, sockets, prompts })
    setMcpResourceServer(createMcpResourceServer({ resourcesDir, mcpResources }))
    const cliName = cliProgramName ?? 'app'
    /* The app's public identity, shared by the identity probe and the OpenAPI spec. */
    const appName = appInfo?.name ?? cliName
    const appVersion = appInfo?.version ?? '0.0.0'
    /* The app's default log channel — every unchanneled record speaks as [appName]. */
    setAppName(appName)
    /*
    Opt-in inspector (BELTE_ENABLE_INSPECTOR=true): a dynamically-imported
    `@belte/inspector` handler, or undefined when the flag is off / the package
    isn't installed. Resolved at boot so the fetch route below can branch on it.
    */
    const inspectorHandler = await maybeMountInspector({ name: appName, version: appVersion })
    const cliCwd = process.cwd()
    /* Route → components: layout/error prefix matching + module loading live behind this seam. */
    const viewResolver = createViewResolver({ pages, layouts, errors })

    /* Request closing records are on by default — DEBUG=-belte is the off switch (negation, like the belte channel itself). */
    const logRequests = !isDebugNegated('belte')

    // App-configured headers extend the in-process forward allowlist for the process lifetime.
    extraForwardHeaders.set(app?.forwardHeaders ?? [])

    /*
    SSR document assembly — view render, cache snapshot partition, `__SSR__`
    state tag, shell splicing — lives behind createPageRenderer. renderError
    also serves the 404 fallthrough below.
    */
    const { renderPage, renderError } = createPageRenderer({
        shell: activeShell,
        base,
        clientTimeout: parseBoundedEnvInt(process.env.BELTE_CLIENT_TIMEOUT, 1, 600_000),
        viewResolver,
        /* The wire payload, rebuilt per marked render — the __SSR__ health seed must match what /__belte/health serves. */
        healthPayload: (request) => buildHealthPayload(request, { app, appName, appVersion }),
    })

    /*
    Route dispatch — rpc-vs-page-vs-404 resolution and method matching — lives
    behind createRouteDispatcher; renderPage is injected so those decisions stay
    testable without SSR. buildRoutes() below binds the returned handler per URL.
    */
    const buildRouteHandler = createRouteDispatcher({ pages, rpc, renderPage })

    /* The per-request seam every dynamic route crosses: scope + app.handle +
       idle-timeout opt-out. Closed over the live `server` (assigned below) for
       disableIdleTimeoutForStream; called only at request time, after bind. */
    const dispatchRequest: DispatchRequest = (req, pathParams, handler, url) =>
        runWithRequestScope(req, { app, logRequests, url }, async (store) => {
            const response = app?.handle
                ? await app.handle(req, (next) => handler(next, pathParams, store))
                : await handler(req, pathParams, store)
            // Streaming bodies (sse/jsonl, socket tail) opt out of the idle timeout.
            return disableIdleTimeoutForStream(server, req, response)
        })

    /* One Bun `routes` entry per page/rpc URL, bound through dispatchRequest. */
    const routes = createRouteRegistry({ pages, rpc, buildRouteHandler, dispatchRequest })

    /*
    Belte's only native WebSocket surface is the sockets hub: every Socket
    declared under src/server/sockets/ multiplexes onto one framework-owned
    connection per client at /__belte/sockets. The dispatcher owns the
    open/message/close lifecycle; user code never sees the raw ws. Steady-state
    fan-out rides Bun's native server.publish so a busy socket doesn't iterate
    JS per subscriber per message.
    */
    const socketDispatcher = createSocketDispatcher(sockets)

    /* Framework probe/operator surface (health/identity, inspector, dev reload/rebuild). */
    const probingEndpoints = createProbingEndpoints({
        app,
        appName,
        appVersion,
        inspectorHandler,
        clientFingerprint,
        dev,
    })

    /* Bun.serve's fetch for everything the routes table doesn't claim. */
    const fetch = createFetchHandler({
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
    })

    /* Bun's websocket handler block — delegates the ws lifecycle to the dispatcher. */
    const websocket = createWebsocketHandler(socketDispatcher)

    /*
    Bind the real server on `boundPort`. Only the port varies between scan
    attempts, so the rest of the config lives inline and just the port is spread
    in — passing the literal straight to Bun.serve keeps contextual typing of the
    websocket handlers (and Server<unknown> pins Bun's WebSocketData generic so
    upgrade({ data: {} }) typechecks).
    */
    const bindAt = (boundPort: number): Server<unknown> =>
        Bun.serve({
            port: boundPort,
            idleTimeout,
            maxRequestBodySize,
            /*
            Dev workers overlap during a restart: the replacement binds while its
            predecessor still serves, and the kernel keeps delivering connections
            to the old listener until it stops — the port never refuses a request
            mid-swap. Dev-only: in production a port collision should fail loudly.
            */
            reusePort: dev,

            websocket,

            routes,

            fetch,

            error(err) {
                belteLog.error(err)
                return internalErrorResponse(err)
            },
        })

    /*
    A configured PORT binds that exact port — a collision surfaces loudly rather
    than silently moving, since something connecting to the app needs a known
    address. With none set, scan upward from 3000 binding the real listener, so
    whichever server wins the port keeps it (no probe-release gap to lose it in,
    which used to crash boot on EADDRINUSE instead of stepping to the next port).
    */
    const server: Server<unknown> =
        port === undefined ? listenOnOpenPort(bindAt, DEFAULT_PORT) : bindAt(port)

    /*
    Publishes the live server through `belte/server` before invoking the
    user's init() hook. The exported `server()` function reads from this
    slot and throws on access before the slot is set, so init() callers
    can hold the import at module scope and still see the real instance
    once boot completes.
    */
    setActiveServer(server)

    const cleanup = app?.init ? await app.init({ server }) : undefined
    /*
    Close the listener deterministically on shutdown. Always registered (even
    with no init cleanup) so the socket is released via server.stop rather than
    left to abrupt process exit — which leaves the port in TIME_WAIT and races
    a fast restart. A watchdog force-exits if a user cleanup hangs, so a stuck
    cleanup can't keep the process (and its port) alive.
    */
    const shutdown = async () => {
        server.stop(true)
        if (typeof cleanup === 'function') {
            setTimeout(() => process.exit(0), 3000).unref()
            try {
                await cleanup()
            } catch (err) {
                belteLog.error(err)
            }
        }
        process.exit(0)
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)

    /*
    Diagnostic only, and only under `belte` debug logging — eager-loads the
    registry to print the page/socket/rpc surface maps (routing + which
    declarations reach mcp/cli/openapi), making belte's multimodal-by-default
    exposure auditable. Awaited so `ready` lands after all of belte's own
    startup output rather than interleaving with it.
    */
    if (logRequests) {
        await logExposedSurfaces({ pages, resolver: viewResolver })
    }
    // Unguarded machine surface check — app.handle is the blessed auth seam.
    if (mcp && !app?.handle) {
        await warnUnguardedMcp()
    }
    belteLog.success(`ready at http://localhost:${server.port}`)
    // Tell the dev orchestrator (when it spawned us with ipc) that boot is
    // complete, so it can retire the previous worker — finishing the
    // zero-downtime swap. No-op on a bare server: process.send is undefined.
    if (dev) {
        process.send?.(DEV_READY_MESSAGE)
    }
    return server
}
