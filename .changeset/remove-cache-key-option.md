---
"@briancray/belte": minor
---

Remove the `key` option from `cache()`.

**Breaking:** `cache(fn, { key })` and the `{ key }` selector form of `cache.invalidate` / `cache.pending` are gone. Cache keys are always auto-derived — method+url+args for a remote function, producer-reference+args for a plain producer. To share an entry across calls, hoist the producer to a stable reference (an inline arrow gets a fresh identity every call and never dedupes). To target a set of unrelated calls with one `cache.invalidate`, tag them with a `scope`; a unique tag (e.g. a uuid) gives a set of calls their own private invalidation group.
