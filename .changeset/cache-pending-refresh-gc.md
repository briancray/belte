---
"@belte/belte": patch
---

Cache reload-marker (`refreshing()`) correctness on the tab store. A policy-less `cache.invalidate` now mints its reload marker only when a reactive scope is actually holding the key's value, and the marker is pruned when that reader tears down without re-reading. Previously the marker was added unconditionally: invalidating a key with nothing on screen made its next (genuinely first-ever) mount report `refreshing()` instead of `pending()`, and the markers accreted unbounded on the long-lived client store across a session. The normal on-screen invalidate → reread reload flag is unchanged.
