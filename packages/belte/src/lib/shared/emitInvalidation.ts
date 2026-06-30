import { invalidateEvent } from './invalidateEvent.ts'
import type { CacheStore } from './types/CacheStore.ts'

/* Dispatches the invalidate event for `keys` so subscribed readers re-run; a no-op when nothing changed. */
export function emitInvalidation(store: CacheStore, keys: string[]): void {
    if (keys.length === 0) {
        return
    }
    store.events.dispatchEvent(invalidateEvent(keys))
}
