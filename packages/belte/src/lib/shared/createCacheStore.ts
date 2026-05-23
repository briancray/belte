import { createSubscriber } from 'svelte/reactivity'
import type { CacheEntry } from '../types/CacheEntry.ts'
import type { CacheStore } from '../types/CacheStore.ts'

/*
Returns a fresh cache store. On the server, every request gets its own
store via the AsyncLocalStorage RequestStore. On the client, a single
module-level store is created at startup and shared across the tab.

Each key gets a lazily-created Svelte subscriber. Reading a key from a
tracking scope ($derived / $effect) subscribes that scope; invalidating
the key dispatches an 'invalidate' event which the subscriber forwards as
an `update()` — Svelte re-runs the tracker, the cache misses, and a fresh
promise is inserted. Outside a tracking scope subscribe() is a no-op, so
the same call works from server code and plain client code.
*/
export function createCacheStore(): CacheStore {
    const entries = new Map<string, CacheEntry>()
    const events = new EventTarget()
    const subscribers = new Map<string, () => void>()

    function subscribe(key: string): void {
        let registered = subscribers.get(key)
        if (!registered) {
            registered = createSubscriber((update) => {
                const onInvalidate = (event: Event) => {
                    if ((event as CustomEvent<string[]>).detail.includes(key)) {
                        update()
                    }
                }
                events.addEventListener('invalidate', onInvalidate)
                return () => events.removeEventListener('invalidate', onInvalidate)
            })
            subscribers.set(key, registered)
        }
        registered()
    }

    return { entries, events, subscribe }
}
