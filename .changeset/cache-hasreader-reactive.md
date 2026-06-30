---
"@belte/belte": patch
---

Fix the cache reload marker (`refreshing()` after a policy-less `cache.invalidate`) firing for keys read outside a tracking scope. `hasReader` reported a phantom reader for any key ever read — including a plain `await cache(fn)()` in an event handler — so `invalidate()` could accrete a `pendingRefresh` marker on the long-lived tab store for keys nobody is reactively holding. The marker is now gated on a live reactive reader (mirroring `tail.ts`), matching the documented `CacheStore` contract that an untracked read is a no-op; a tracked read still flags the reload exactly as before.
