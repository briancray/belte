import type { CacheEntry } from './CacheEntry.ts'

/*
Cache map paired with a Svelte-aware per-key subscriber. Calling
`subscribe(key)` from inside a tracking scope ($derived / $effect) registers
that scope to re-run when the entry is invalidated; called outside tracking
it's a no-op. The server uses a fresh store per request, the client uses a
single module-level store.
*/
export type CacheStore = {
    entries: Map<string, CacheEntry>
    events: EventTarget
    subscribe: (key: string) => void
}
