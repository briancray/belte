import type { CacheOptions } from './types/CacheOptions.ts'

/*
Normalises the `swr` option to its coalescing window, or undefined when no
policy is set. `true` is the immediate form — an empty window, so a refetch fires
on the leading edge of every invalidate (scheduleInvalidationRefetch sees no
throttle/debounce and fires at once); `false` reads as no policy, the hard-drop
default. The object form carries its throttle/debounce through unchanged.
*/
export function policyWindow(
    swr: CacheOptions['swr'],
): { throttle?: number; debounce?: number } | undefined {
    if (swr === undefined || swr === false) {
        return undefined
    }
    return swr === true ? {} : swr
}
