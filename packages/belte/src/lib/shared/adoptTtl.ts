import { armTtlExpiry } from './armTtlExpiry.ts'
import { evictIfCurrent } from './evictIfCurrent.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheOptions } from './types/CacheOptions.ts'
import type { CacheStore } from './types/CacheStore.ts'

/*
Mirrors applyTags/attachPolicy for retention: a hydrated snapshot entry ships
without its wrap options (they live at call sites, not on the wire), so the
first read adopts its call site's ttl declaration. Omitted = forever, exactly
as shipped; ttl > 0 = the expiry clock starts at this read; ttl = 0 = the warm
value exists only to complete the hydration render — the SSR request's atomic
unit ends here — so eviction is deferred one macrotask (every reader in the
same hydration pass still gets the warm value, no invalidate event fires, and
the already-painted DOM stays put) and the next read fetches live. The first
reader consumes the flag, so its declaration wins; live entries never carry
the flag and keep the ttl they registered with.
*/
export function adoptTtl(
    store: CacheStore,
    entry: CacheEntry,
    options: CacheOptions | undefined,
): void {
    if (entry.hydrated !== true) {
        return
    }
    entry.hydrated = false
    const ttl = options?.ttl
    if (ttl === undefined) {
        return
    }
    entry.ttl = ttl
    if (ttl === 0) {
        setTimeout(() => evictIfCurrent(store, entry), 0).unref?.()
        return
    }
    armTtlExpiry(store, entry, ttl)
}
