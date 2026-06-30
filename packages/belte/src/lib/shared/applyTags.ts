import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheOptions } from './types/CacheOptions.ts'

/*
Tags an existing entry with a read's tags so a later cache.invalidate({ tags })
reaches entries hydrated from the SSR snapshot (which carry a value but no tags)
without a refetch. Merges rather than replaces so a read tagging one group can't
drop tags another read site already added; a no-op when the read passes no tags.
Mutates in place and short-circuits when the entry already carries every incoming
tag — the steady-state warm read (a re-render of an already-tagged entry) then
allocates nothing instead of building and discarding a fresh Set each pass.
*/
export function applyTags(entry: CacheEntry, tags: CacheOptions['tags']): void {
    if (tags === undefined) {
        return
    }
    if (entry.tags === undefined) {
        entry.tags = new Set(tags)
        return
    }
    if (tags.every((tag) => entry.tags!.has(tag))) {
        return
    }
    tags.forEach((tag) => entry.tags!.add(tag))
}
