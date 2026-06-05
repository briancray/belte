import type { CacheEntry } from './CacheEntry.ts'

/*
Cache map paired with a Svelte-aware per-key subscriber. Calling
`subscribe(key)` from inside a tracking scope ($derived / $effect) registers
that scope to re-run when the entry is invalidated; called outside tracking
it's a no-op. Subscribers live for the lifetime of the store: the server
uses a fresh store per request (so subscribers die with the response), the
client uses a single module-level store (so subscribers persist for the tab).

`trackLifecycle` is the store-wide counterpart used by cache.pending: unlike a
keyed read it matches many entries (or all), so it re-derives by scanning
entries and only needs one "in-flight membership changed" signal. Reading it in
a tracking scope re-runs that scope whenever any call starts, settles, or is
evicted.
*/
export type CacheStore = {
    entries: Map<string, CacheEntry>
    events: EventTarget
    subscribe: (key: string) => void
    trackLifecycle: () => void
}
