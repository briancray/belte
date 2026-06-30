import { evictIfCurrent } from './evictIfCurrent.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheStore } from './types/CacheStore.ts'

/* Arms the ttl > 0 expiry sweep; `expiresAt` re-checks at fire time so a refreshed deadline survives. */
export function armTtlExpiry(store: CacheStore, entry: CacheEntry, ttl: number): void {
    entry.expiresAt = Date.now() + ttl
    setTimeout(() => {
        if ((entry.expiresAt ?? 0) <= Date.now()) {
            evictIfCurrent(store, entry)
        }
    }, ttl).unref?.()
}
