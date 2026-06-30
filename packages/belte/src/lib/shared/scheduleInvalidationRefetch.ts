import { emitInvalidation } from './emitInvalidation.ts'
import { evictIfCurrent } from './evictIfCurrent.ts'
import { HttpError } from './HttpError.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheStore } from './types/CacheStore.ts'

/*
Schedules a coalesced refetch per the entry's swr policy. debounce: (re)arm
a timer that fires after N ms of quiet. throttle: fire on the leading edge when a
full window has elapsed since the last fire, else arm a single trailing timer for
the remainder — so a continuous invalidation stream refetches at most once per window.
*/
export function scheduleInvalidationRefetch(store: CacheStore, entry: CacheEntry): void {
    const policy = entry.invalidation
    if (!policy) {
        return
    }
    if (policy.debounce !== undefined) {
        clearTimeout(policy.timer)
        policy.timer = armTimer(store, entry, policy.debounce)
        return
    }
    const throttleMs = policy.throttle ?? 0
    const elapsed = Date.now() - (policy.lastFiredAt ?? Number.NEGATIVE_INFINITY)
    if (elapsed >= throttleMs) {
        fireRefetch(store, entry)
        return
    }
    if (policy.timer === undefined) {
        policy.timer = armTimer(store, entry, throttleMs - elapsed)
    }
}

function armTimer(store: CacheStore, entry: CacheEntry, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
        if (entry.invalidation) {
            entry.invalidation.timer = undefined
        }
        fireRefetch(store, entry)
    }, ms)
    timer.unref?.()
    return timer
}

/*
Runs the captured refetch once, keeping the stale value visible until it
resolves, then swaps the fresh result in and notifies readers. A refetch already
in flight is left to finish — the key is stable, so it already fetches the latest
state. Failure arrives on either settle path: a remote refetch resolves with the
Response even on an error status (fetch rejects only on network loss), a producer
rejects. Both route to settleRefetchFailure — stale kept, except a 404 evicts.
*/
function fireRefetch(store: CacheStore, entry: CacheEntry): void {
    const policy = entry.invalidation
    if (!policy || entry.refreshing) {
        return
    }
    entry.refreshing = true
    policy.lastFiredAt = Date.now()
    /* Ping lifecycle so refreshing() re-derives when revalidation begins; the settle handlers ping again when it ends. */
    store.markLifecycle(entry.key)
    const inflight = policy.refetch()
    inflight.then(
        (result) => {
            entry.refreshing = false
            /* Dropped or replaced while in flight — discard this result. */
            if (store.entries.get(entry.key) !== entry) {
                return
            }
            if (result instanceof Response && !result.ok) {
                settleRefetchFailure(store, entry, result.status)
                return
            }
            entry.promise = inflight
            entry.value = undefined
            entry.settled = true
            store.markLifecycle(entry.key)
            emitInvalidation(store, [entry.key])
        },
        (error) => {
            entry.refreshing = false
            if (store.entries.get(entry.key) !== entry) {
                return
            }
            settleRefetchFailure(
                store,
                entry,
                error instanceof HttpError ? error.status : undefined,
            )
        },
    )
}

/*
A failed revalidation keeps the stale entry — blanking data a reader is showing
over a transient error would make every background refresh a risk. 404 is the
exception: the resource is gone, so the retained value is a ghost an invalidation
stream would refetch forever. Evict it exactly as invalidate() drops a policy-less
entry (pendingRefresh marks the next read a reload; the notify re-runs readers),
so a live read replaces it and surfaces the proper error once.
*/
function settleRefetchFailure(store: CacheStore, entry: CacheEntry, status?: number): void {
    if (status === 404) {
        evictIfCurrent(store, entry)
        /* Mirror invalidate()'s gating: only flag a reload when a reader still holds
           the value — a background refetch can 404 after the reader navigated away, and
           an ungated add then lingers forever on the tab store (no teardown to prune it). */
        if (store.hasReader(entry.key)) {
            store.pendingRefresh.add(entry.key)
        }
        emitInvalidation(store, [entry.key])
        return
    }
    store.markLifecycle(entry.key)
}
