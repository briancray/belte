import type { CacheOptions } from '../types/CacheOptions.ts'
import type { RemoteFunction } from '../types/RemoteFunction.ts'
import type { RemoteResponse } from '../types/RemoteResponse.ts'
import { activeCacheStore } from './activeCacheStore.ts'
import { canonicalJson } from './canonicalJson.ts'
import { keyForRemoteCall } from './keyForRemoteCall.ts'
import { getRemoteMeta } from './remoteMeta.ts'

/*
Curries a remote-function call against the request-scoped cache store.
`cache(fn, options?)` returns an invoker; calling that invoker with args
checks the store for a prior entry (keyed by fn.method + fn.url + args) and
returns its response clone on hit, or invokes `fn(args)` once and stores
the result on miss. Splitting configuration (the outer call) from invocation
(the inner call) keeps options anchored in a fixed position so they can't
collide with arg shapes. TTL = undefined → forever; ttl = 0 → dedupe only;
ttl > 0 → entry expires `ttl` ms after the promise resolves.

Reactivity is implicit: the invoker calls `store.subscribe(key)`, which
registers the surrounding $derived / $effect scope. Invalidating the key
then re-runs that scope, which calls cache() again and gets a fresh entry.
Outside a tracking scope subscribe() is a no-op, so cache() works the same
in server code and plain client code.
*/
export function cache<Args, Return>(
    fn: RemoteFunction<Args, Return>,
    options?: CacheOptions,
): (args?: Args) => Promise<RemoteResponse<Return>> {
    return (args) => invokeWithCache(fn, args, options)
}

function invokeWithCache<Args, Return>(
    fn: RemoteFunction<Args, Return>,
    args: Args | undefined,
    options: CacheOptions | undefined,
): Promise<RemoteResponse<Return>> {
    const store = activeCacheStore()
    const key = resolveKey(fn, args, options?.key)
    store.subscribe(key)
    const existing = store.entries.get(key)
    if (existing) {
        return shareable(existing.promise) as Promise<RemoteResponse<Return>>
    }
    const promise = fn(args as Args)
    const meta = getRemoteMeta(promise)
    if (!meta) {
        throw new Error(
            '[belte] cache() received a function whose call did not record metadata — was it produced by a verb helper?',
        )
    }
    const ttl = options?.ttl
    const entry = {
        key,
        promise: promise as Promise<RemoteResponse<unknown>>,
        request: meta.request,
        ttl,
        expiresAt: undefined as number | undefined,
    }
    store.entries.set(key, entry)
    promise.then(
        () => {
            if (ttl === 0) {
                store.entries.delete(key)
                return
            }
            if (ttl !== undefined) {
                entry.expiresAt = Date.now() + ttl
                setTimeout(() => {
                    if (store.entries.get(key) === entry && (entry.expiresAt ?? 0) <= Date.now()) {
                        store.entries.delete(key)
                    }
                }, ttl).unref?.()
            }
        },
        () => {
            store.entries.delete(key)
        },
    )
    return shareable(promise)
}

/*
Returns a promise that resolves to a fresh clone of the underlying Response.
Multiple readers can each consume the body independently — the stored
promise's Response is never consumed directly, so clones always succeed.
*/
function shareable<Return>(
    promise: Promise<RemoteResponse<Return>>,
): Promise<RemoteResponse<Return>> {
    return promise.then((response) => response.clone() as RemoteResponse<Return>)
}

cache.invalidate = function invalidate(
    arg?: RemoteFunction<unknown, unknown> | CacheOptions['key'],
): void {
    const store = activeCacheStore()
    if (arg === undefined) {
        const keys = Array.from(store.entries.keys())
        store.entries.clear()
        emit(store, 'invalidate', keys)
        return
    }
    if (typeof arg === 'function') {
        const prefix = `${arg.method} ${arg.url}`
        const affected: string[] = []
        for (const key of store.entries.keys()) {
            if (key === prefix || key.startsWith(`${prefix} `) || key.startsWith(`${prefix}?`)) {
                affected.push(key)
            }
        }
        affected.forEach((key) => store.entries.delete(key))
        emit(store, 'invalidate', affected)
        return
    }
    const target = canonicalKey(arg)
    if (store.entries.delete(target)) {
        emit(store, 'invalidate', [target])
    }
}

function resolveKey<Args, Return>(
    fn: RemoteFunction<Args, Return>,
    args: Args | undefined,
    override: CacheOptions['key'],
): string {
    if (override !== undefined) {
        return canonicalKey(override)
    }
    return keyForRemoteCall(fn.method, fn.url, args)
}

function canonicalKey(value: CacheOptions['key']): string {
    if (typeof value === 'string') {
        return value
    }
    return canonicalJson(value)
}

function emit(
    store: ReturnType<typeof activeCacheStore>,
    type: 'invalidate',
    keys: string[],
): void {
    store.events.dispatchEvent(new CustomEvent(type, { detail: keys }))
}
