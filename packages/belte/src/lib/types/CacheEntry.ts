import type { RemoteResponse } from './RemoteResponse.ts'

/*
Stored shape per cache key. `request` is retained so SSR snapshot
serialization can record the URL and method without re-deriving them from
the function. `ttl`/`expiresAt` drive eviction: expiresAt = undefined means
"no TTL" (lives forever); ttl = 0 means "dedupe only" (entry is pruned as
soon as the promise settles).
*/
export type CacheEntry = {
    key: string
    promise: Promise<RemoteResponse<unknown>>
    request: Request
    ttl: number | undefined
    expiresAt: number | undefined
}
