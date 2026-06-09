---
"@belte/claude-code": patch
---

`serve` ends shortly after the last subscriber disconnects, so `bunx @belte/claude-code serve` doesn't linger once you close the tab. Exposed as `onIdle`/`idleGraceMs` (the bin exits 30s after the page closes; a reload reconnects within the grace and cancels it). Only armed after the first connection, so the bridge waits indefinitely for the page to first appear; programmatic `serve()` callers omit `onIdle` to stay resident.
