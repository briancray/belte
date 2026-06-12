import { HEALTH_PATH } from '../shared/HEALTH_PATH.ts'
import { IDENTITY_PATH } from '../shared/IDENTITY_PATH.ts'
import { isBelteHealthPayload } from '../shared/isBelteHealthPayload.ts'

// The identity shape a belte server returns from GET /__belte/health (and its /__belte/identity alias).
export type BelteIdentity = { name: string; version: string }

/*
Confirms a URL points at a belte server before the launcher navigates the app
window there, by fetching its unauthenticated health endpoint. Returns the
server's identity on success, or undefined when nothing belte answers — a network
error, the wrong port, or a non-belte page (a bare 403/404, a different app, a
captive portal's 200 — hence the `belte: true` body check, never response.ok
alone). The endpoint bypasses the app's own middleware, so an auth-guarded belte
app still verifies here even though its pages would later redirect to a login.
Probes HEALTH_PATH first, falling back to the IDENTITY_PATH alias so a newer
launcher still recognises an older belte server. The fallback only runs when
the host actually answered (an older server 404s the health path) — a network
error or timeout skips it, because a host that didn't answer one path won't
answer the other and each attempt costs the full timeout (this probe sits in
the launcher's liveness loop).
*/
export async function probeBelteServer(target: string): Promise<BelteIdentity | undefined> {
    const base = target.replace(/\/+$/, '')
    try {
        return (
            (await probeIdentityAt(`${base}${HEALTH_PATH}`)) ??
            (await probeIdentityAt(`${base}${IDENTITY_PATH}`))
        )
    } catch {
        return undefined
    }
}

/* Throws on network error/timeout; undefined means the host answered but isn't a belte server at this path. */
async function probeIdentityAt(url: string): Promise<BelteIdentity | undefined> {
    const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
        return undefined
    }
    try {
        const body = (await response.json()) as {
            belte?: unknown
            name?: string
            version?: string
        }
        if (!isBelteHealthPayload(body)) {
            return undefined
        }
        return { name: body.name ?? 'belte app', version: body.version ?? '0.0.0' }
    } catch {
        return undefined
    }
}
