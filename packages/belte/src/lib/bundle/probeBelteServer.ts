import { IDENTITY_PATH } from '../shared/IDENTITY_PATH.ts'

// The identity shape a belte server returns from GET /__belte/identity.
export type BelteIdentity = { name: string; version: string }

/*
Confirms a URL points at a belte server before the launcher navigates the app
window there, by fetching its unauthenticated identity endpoint. Returns the
server's identity on success, or undefined when nothing belte answers — a network
error, the wrong port, or a non-belte page (a bare 403/404, a different app). The
endpoint bypasses the app's own middleware, so an auth-guarded belte app still
verifies here even though its pages would later redirect to a login.
*/
export async function probeBelteServer(target: string): Promise<BelteIdentity | undefined> {
    try {
        const base = target.replace(/\/+$/, '')
        const response = await fetch(`${base}${IDENTITY_PATH}`, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
        })
        if (!response.ok) {
            return undefined
        }
        const body = (await response.json()) as {
            belte?: boolean
            name?: string
            version?: string
        }
        if (body.belte !== true) {
            return undefined
        }
        return { name: body.name ?? 'belte app', version: body.version ?? '0.0.0' }
    } catch {
        return undefined
    }
}
