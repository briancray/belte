import type { CacheStore } from '../types/CacheStore.ts'
import { createCacheStore } from './createCacheStore.ts'

/*
Resolves the active CacheStore. The runtime is registered via
`setCacheStoreResolver` from the server entry (request-scoped via ALS)
or the client entry (module-level singleton). If no resolver is registered,
a single fallback store is created lazily so isolated tests still work.
*/

let resolver: (() => CacheStore | undefined) | undefined
let fallback: CacheStore | undefined

export function setCacheStoreResolver(fn: () => CacheStore | undefined): void {
    resolver = fn
}

export function activeCacheStore(): CacheStore {
    const fromResolver = resolver?.()
    if (fromResolver) {
        return fromResolver
    }
    if (!fallback) {
        fallback = createCacheStore()
    }
    return fallback
}
