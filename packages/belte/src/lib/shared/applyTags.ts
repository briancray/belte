import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheOptions } from './types/CacheOptions.ts'

/* Folds new tags into an entry's existing set without duplicating them. */
function mergeTags(existing: Set<string> | undefined, incoming: string[]): Set<string> {
    return new Set([...(existing ?? []), ...incoming])
}

/*
Tags an existing entry with a read's tags so a later cache.invalidate({ tags })
reaches entries hydrated from the SSR snapshot (which carry a value but no tags)
without a refetch. Merges rather than replaces so a read tagging one group can't
drop tags another read site already added; a no-op when the read passes no tags.
*/
export function applyTags(entry: CacheEntry, tags: CacheOptions['tags']): void {
    if (tags !== undefined) {
        entry.tags = mergeTags(entry.tags, tags)
    }
}
