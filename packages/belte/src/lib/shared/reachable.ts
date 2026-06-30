import { createSubscriber } from 'svelte/reactivity'
import { createReachable } from './createReachable.ts'
import { originOf } from './originOf.ts'
import { parseBoundedEnvInt } from './parseBoundedEnvInt.ts'

/*
Isomorphic outbound reachability for a host. `await reachable(host)` HEADs the
host's origin from whichever side runs it: the first call awaits a real probe
(faithful — a down host costs the full timeout, an up host one handshake) and
starts a background poll that re-probes every TTL, so every later call resolves
instantly off the warm value, fresh within one TTL. A down host going down is
caught within ~failureLimit polls; recovery flips it back automatically.

  if (!(await reachable('api.example.com'))) return error(503)

Bare `reachable()` defaults to the app's own server origin — on the browser the
live origin the page came from, on the server APP_URL — so a component can ask
"can I reach my backend right now" as the active-probe complement to online():
online() reports the browser's *claimed* connectivity (navigator.onLine),
reachable() proves the round-trip actually completes.

Like online(), reactivity is opt-in by where you read it. Read inside a
$derived/$effect on the client and the scope re-runs when the host flips up or
down (the warm poll drives it); call it at a decision point and you just get the
current warm value. Server reads are one-shot — SSR is a single render pass.

A bare host string defaults to https; pass an explicit http://… for a non-TLS
host. Answers "can this side connect to the host," NOT "is the endpoint
healthy": any completed HTTP response (even 4xx/5xx, even a 405 to HEAD) counts
as reachable — the browser probe runs no-cors, so a connection failure or
timeout rejects while any opaque response resolves. See online() for the
inbound/client-reported counterpart.

BELTE_REACHABLE_INTERVAL (poll cadence / freshness, ms) and BELTE_REACHABLE_TIMEOUT
(per-HEAD bound, ms) tune the server defaults; the timeout is deliberately
generous so a healthy-but-distant host over a slow link is not mis-read as down.
*/
const IS_SERVER = typeof window === 'undefined'
const TTL_MS =
    (IS_SERVER
        ? parseBoundedEnvInt(process.env.BELTE_REACHABLE_INTERVAL, 1_000, 600_000)
        : undefined) ?? 30_000
const TIMEOUT_MS =
    (IS_SERVER
        ? parseBoundedEnvInt(process.env.BELTE_REACHABLE_TIMEOUT, 100, 60_000)
        : undefined) ?? 3_000
/* Stop polling a host nobody has read in a few TTLs; the next read restarts it cold. */
const IDLE_MS = TTL_MS * 3

/* Status-agnostic HEAD: a completed response proves connectivity, reject/timeout does not.
   no-cors is what lets a cross-origin browser probe resolve on any opaque response; on the
   server it is an inert no-op (server fetch enforces no CORS), so one probe works both sides. */
async function probeOrigin(origin: string): Promise<boolean> {
    try {
        await fetch(origin, {
            method: 'HEAD',
            mode: 'no-cors',
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        return true
    } catch {
        return false
    }
}

/* Per-origin reactive subscriber (client only): reading reachable(origin) in a
   reactive scope subscribes that scope to the origin's up/down flips; the poll's
   notify() calls the captured update() to re-run it. */
const updaterByOrigin = new Map<string, () => void>()
const subscriberByOrigin = new Map<string, () => void>()
function subscribeToOrigin(origin: string): void {
    let subscribe = subscriberByOrigin.get(origin)
    if (!subscribe) {
        subscribe = createSubscriber((update) => {
            updaterByOrigin.set(origin, update)
            return () => updaterByOrigin.delete(origin)
        })
        subscriberByOrigin.set(origin, subscribe)
    }
    subscribe()
}

const registry = createReachable({
    probe: probeOrigin,
    intervalMs: TTL_MS,
    idleMs: IDLE_MS,
    notify: IS_SERVER ? undefined : (origin) => updaterByOrigin.get(origin)?.(),
})

/* The app's own server origin for bare reachable(): the browser's live origin,
   or APP_URL's origin on the server. Unset APP_URL leaves the server with no
   host to name — bare then reads vacuously reachable (the optimistic seed). */
function appOrigin(): string | undefined {
    if (!IS_SERVER) {
        return window.location.origin
    }
    if (!process.env.APP_URL) {
        return undefined
    }
    try {
        return originOf(process.env.APP_URL)
    } catch {
        return undefined
    }
}

// @readme probes
export function reachable(host?: string | URL): Promise<boolean> {
    const target = host ?? appOrigin()
    if (target === undefined) {
        return Promise.resolve(true)
    }
    /* Only the client subscriber needs the canonical origin up front (to match the
       poll's notify key); registry.reachable normalizes `target` itself, so the server
       path normalizes once rather than twice. */
    if (!IS_SERVER) {
        subscribeToOrigin(originOf(target))
    }
    return registry.reachable(target)
}
