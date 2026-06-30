import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheStore } from './types/CacheStore.ts'

/*
Evicts `entry` unless a newer entry already owns the key (a concurrent
invalidate-and-reread must not lose its replacement). Disarms any policy timer
first — an armed timer would otherwise refetch a key that no longer exists.
*/
export function evictIfCurrent(store: CacheStore, entry: CacheEntry): void {
    if (store.entries.get(entry.key) === entry) {
        clearTimeout(entry.invalidation?.timer)
        store.entries.delete(entry.key)
        store.markLifecycle(entry.key)
    }
}
