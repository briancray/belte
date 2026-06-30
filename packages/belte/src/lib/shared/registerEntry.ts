import { armTtlExpiry } from './armTtlExpiry.ts'
import { evictIfCurrent } from './evictIfCurrent.ts'
import { policyWindow } from './policyWindow.ts'
import { toTagSet } from './toTagSet.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheOptions } from './types/CacheOptions.ts'
import type { CacheStore } from './types/CacheStore.ts'

/*
Stores a fresh entry and wires its settle / ttl / eviction lifecycle. Shared by
the remote and producer paths; `request` is set for remote entries (drives the
SSR snapshot) and undefined for producers.
*/
export function registerEntry(
    store: CacheStore,
    key: string,
    promise: Promise<unknown>,
    options: CacheOptions | undefined,
    request: Request | undefined,
    refetch: () => Promise<unknown>,
    label?: string,
): CacheEntry {
    const ttl = options?.ttl
    /* Capture the refetch thunk + policy only when an swr policy was asked for. */
    const policy = policyWindow(options?.swr)
    const invalidation = policy
        ? { refetch, throttle: policy.throttle, debounce: policy.debounce }
        : undefined
    /*
    A prior entry for this key was dropped by invalidate() and is awaiting its
    next read — consume the marker so this replacement read reports as a reload
    (refreshing()) until it settles, not as a first-ever load.
    */
    const refreshing = store.pendingRefresh.delete(key) || undefined
    const entry: CacheEntry = {
        key,
        label,
        promise,
        request,
        ttl,
        expiresAt: undefined,
        tags: options?.tags === undefined ? undefined : toTagSet(options.tags),
        refreshing,
        invalidation,
    }
    store.entries.set(key, entry)
    store.markLifecycle(key)
    /*
    A ttl=0 remote entry in the request-scoped server store is kept until the
    store dies with the response. The request is the server's atomic unit, so
    a ttl=0 entry retains nothing beyond it but coalesces everything within
    it: identical calls during one render — any method — share one effect
    deterministically, regardless of settle timing, and the post-render SSR
    snapshot can still pick up replayable entries (the snapshot applies its
    own method filter; writes never ship). The keep never applies on the
    client (the tab store outlives any unit — a kept write would block every
    future re-submit, so entries evict the moment they settle), to producer
    entries (no request), or to the process-level `global` store (not
    request-scoped — keeping it would leak forever).
    */
    const keepZeroTtlForRequest =
        request !== undefined && !options?.global && typeof window === 'undefined'
    function deleteIfCurrent() {
        evictIfCurrent(store, entry)
    }
    promise.then(() => {
        /*
        Mark settled so SSR snapshot serialization can tell awaited entries
        (resolved by the time render() returns → inline) from {#await} ones
        (still pending → stream). Set before the ttl branches below since a
        ttl=0 server entry stays in the store for the snapshot.
        */
        entry.settled = true
        /* The reload finished — this entry now holds fresh data, no longer refreshing. */
        entry.refreshing = false
        store.markLifecycle(key)
        if (ttl === 0) {
            if (!keepZeroTtlForRequest) {
                deleteIfCurrent()
            }
            return
        }
        if (ttl !== undefined) {
            armTtlExpiry(store, entry, ttl)
        }
    }, deleteIfCurrent)
    return entry
}
