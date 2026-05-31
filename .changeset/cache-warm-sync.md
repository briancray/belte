---
"@briancray/belte": minor
---

`cache()` now returns synchronously for keys already warm in the SSR hydration snapshot, so the first client read of server-rendered data skips the microtask round-trip.
