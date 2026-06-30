import { policyWindow } from './policyWindow.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheOptions } from './types/CacheOptions.ts'

/*
Mirrors applyTags for swr policies: a read declaring a policy arms an
existing entry that lacks one. Hydrated snapshot entries carry a value but no
refetch thunk — without this, the first invalidate after hydration would hard-
drop the entry (a pending flash) instead of revalidating stale-in-place, and a
policy-less first read would permanently win over a later read that declared
one. An entry that already has a policy keeps it (first policy wins; the key
is the same call, so the thunks are interchangeable).
*/
export function attachPolicy(
    entry: CacheEntry,
    options: CacheOptions | undefined,
    refetch: () => Promise<unknown>,
): void {
    /* The entry-has-policy check is a free field read; do it before parsing the
       swr window so a warm read of an already-armed entry skips policyWindow. */
    if (entry.invalidation) {
        return
    }
    const policy = policyWindow(options?.swr)
    if (!policy) {
        return
    }
    entry.invalidation = { refetch, throttle: policy.throttle, debounce: policy.debounce }
}
