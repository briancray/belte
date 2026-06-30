---
"@belte/belte": patch
---

Fix `cache.on().patch()` corrupting non-JSON values. The patch path cloned the updater's output through a JSON round-trip, silently coercing `Date`/`Set`/`Map` and dropping `undefined` fields (and throwing on `BigInt`). It now uses `structuredClone`, so an updater returning `current => ({ ...current, lastSeen: new Date(), roles: new Set(current.roles) })` preserves those types. Also gives the `error({ $belteError, status, data })` descriptor form a `HTTP <status>` reason-phrase fallback, so a typed error declaring a non-standard status no longer surfaces an empty `HttpError.statusText`.
