import type { Server } from 'bun'
import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { DEV_RELOAD_PATH } from '../../shared/DEV_RELOAD_PATH.ts'
import { HEALTH_PATH } from '../../shared/HEALTH_PATH.ts'
import { IDENTITY_PATH } from '../../shared/IDENTITY_PATH.ts'
import { INSPECTOR_PATH } from '../../shared/INSPECTOR_PATH.ts'
import type { AppModule } from '../AppModule.ts'
import { buildHealthPayload } from './buildHealthPayload.ts'
import { DEV_REBUILD_MESSAGE } from './DEV_REBUILD_MESSAGE.ts'
import { devReloadResponse } from './devReloadResponse.ts'
import { disableIdleTimeoutForStream } from './disableIdleTimeoutForStream.ts'
import type { maybeMountInspector } from './maybeMountInspector.ts'

// Dev-only manual rebuild trigger; POSTing signals the orchestrator to rebuild + restart.
const DEV_REBUILD_PATH = '/__belte/reload'

/*
The framework's operator/probe surface — health/identity, the opt-in inspector,
the dev live-reload channel, and the dev manual-rebuild trigger. Each is
answered directly, ahead of any app.handle middleware, so they reach even when
the app guards everything behind auth. Returns a Response when the request hits
one of these, or undefined so the fetch handler falls through to the rest.

A pure move out of createServer's fetch branch; boot-time config (the resolved
inspector handler, dev fingerprint, identity fields, app, dev flag) is captured
once and the returned function carries only per-request inputs.
*/
export function createProbingEndpoints({
    app,
    appName,
    appVersion,
    inspectorHandler,
    clientFingerprint,
    dev,
}: {
    app?: AppModule
    appName: string
    appVersion: string
    /* Opt-in inspector handler, or undefined when BELTE_ENABLE_INSPECTOR is off / the package isn't installed. */
    inspectorHandler: Awaited<ReturnType<typeof maybeMountInspector>>
    /* Dev-only browser-surface fingerprint; undefined outside `belte dev`. */
    clientFingerprint: string | undefined
    dev: boolean
}): (req: Request, url: URL, bunServer: Server<unknown>) => Promise<Response | undefined> {
    return async function probingEndpoints(req, url, bunServer) {
        /*
        Health/identity probe — answered directly, ahead of any app.handle
        middleware, so the bundle's connect screen, the CLI, and the client
        health() can confirm a URL really is a live belte server even when
        the app guards everything behind auth (reporting
        `authenticated: false` requires exactly that). The app's optional
        health hook contributes fields; the framework's identity keys win
        on collision, and a thrown hook is logged and skipped so an app
        bug can't masquerade as an unreachable server. IDENTITY_PATH is
        the compatibility alias for the same payload.
        */
        if (url.pathname === HEALTH_PATH || url.pathname === IDENTITY_PATH) {
            const payload = await buildHealthPayload(req, { app, appName, appVersion })
            return Response.json(
                /*
                The IDENTITY_PATH alias keeps the legacy `belte: true`
                shape: already-shipped probers check it with strict
                equality, and a version string would make them treat
                an upgraded healthy server as not-belte.
                */
                url.pathname === IDENTITY_PATH ? { ...payload, belte: true } : payload,
                { headers: { 'Cache-Control': NO_STORE } },
            )
        }
        /*
        Inspector surface — answered directly, ahead of app.handle, since
        it's privileged operator tooling gated by BELTE_ENABLE_INSPECTOR
        (not the app's user auth). Undefined handler = flag off, so the
        whole block compiles out of the hot path when the inspector's off.
        */
        if (
            inspectorHandler &&
            (url.pathname === INSPECTOR_PATH || url.pathname.startsWith(`${INSPECTOR_PATH}/`))
        ) {
            // The events feed is long-lived SSE: opt it out of the idle
            // timeout, else Bun reaps it and the reconnect replays the
            // whole buffer (duplicate boot logs every ~10s).
            return disableIdleTimeoutForStream(bunServer, req, await inspectorHandler(req, url))
        }
        /*
        Dev live-reload channel — answered directly, ahead of app.handle,
        so a restart-driven reconnect always lands even when the app guards
        everything behind auth. Only mounted under `belte dev`.
        */
        if (clientFingerprint !== undefined && url.pathname === DEV_RELOAD_PATH) {
            // Long-lived SSE: opt out of the idle timeout, else Bun reaps
            // it and the reconnect triggers a spurious reload loop.
            return disableIdleTimeoutForStream(bunServer, req, devReloadResponse(clientFingerprint))
        }
        /*
        Manual rebuild trigger: signal the orchestrator parent over IPC to
        rebuild + restart. Same-origin sibling of the live-reload channel, so
        a script refreshes on the app's own port. process.send exists only when
        the dev orchestrator spawned us with ipc; the optional chain no-ops on a
        bare server.
        */
        if (dev && req.method === 'POST' && url.pathname === DEV_REBUILD_PATH) {
            process.send?.(DEV_REBUILD_MESSAGE)
            return new Response('rebuilding\n')
        }
        return undefined
    }
}
