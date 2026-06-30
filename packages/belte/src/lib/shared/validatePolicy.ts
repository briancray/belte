import { policyWindow } from './policyWindow.ts'
import { REPLAYABLE_METHODS } from './REPLAYABLE_METHODS.ts'
import type { CacheOptions } from './types/CacheOptions.ts'

/*
Guards impossible option combinations at wrap time, where the call site is on
the stack. `swr` declares "this call is safe to re-run unprompted", so a
non-replayable remote method (a write) must never carry one — replaying a write
through the invalidation grammar would be a state change disguised as a
refresh. Producers are opaque (no method to check); the same contract is on
the caller there. ttl: 0 retains nothing, so there is nothing for swr to
revalidate; and the two coalescing strategies are exclusive by construction.
*/
export function validatePolicy(
    options: CacheOptions | undefined,
    method: string | undefined,
): void {
    const policy = policyWindow(options?.swr)
    if (!policy) {
        return
    }
    if (policy.throttle !== undefined && policy.debounce !== undefined) {
        throw new Error('[belte] cache(): set swr.throttle or swr.debounce, not both')
    }
    if (options?.ttl === 0) {
        throw new Error(
            '[belte] cache(): swr requires retention — ttl: 0 keeps nothing to revalidate',
        )
    }
    if (method !== undefined && !REPLAYABLE_METHODS.has(method.toUpperCase())) {
        throw new Error(
            `[belte] cache(): swr re-runs the call unprompted — ${method.toUpperCase()} is a write and must not be replayed`,
        )
    }
}
