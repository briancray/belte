import type { RemoteFunction } from '../types/RemoteFunction.ts'

/*
Client substitute for a remote function declared with `{ hydrate: false }`.
Calling it on the client throws with a clear message — the symbol exists at
runtime so module shape stays the same, but the network call is intentionally
unavailable from the browser.
*/
export function remoteNotHydrated<Args, Return>(name: string): RemoteFunction<Args, Return> {
    const callable: any = () => {
        throw new Error(`[belte] ${name} is server-only (declared with { hydrate: false })`)
    }
    callable.method = 'GET'
    callable.url = ''
    callable.fetch = () => {
        throw new Error(`[belte] ${name} is server-only (declared with { hydrate: false })`)
    }
    return callable
}
