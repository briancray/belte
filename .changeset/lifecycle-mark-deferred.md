---
"@belte/belte": patch
---

**Fixed**

- The lifecycle channel defers its notify to a microtask, coalescing marks within a tick. With a live `pending()`/`refreshing()` probe armed, a cold cache read inside a `$derived` — the documented `$derived(await cache(fn)())` idiom — registered its entry mid-derived and wrote the subscriber's version source synchronously, throwing `state_unsafe_mutation` and killing the flush (seen as an unhandled rejection plus a follow-on `active_reaction` TypeError, with UI updates in that batch silently dropped). Probes scan the registry at re-derive time, so the deferred ping reads state that is already current.
