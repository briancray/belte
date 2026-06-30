---
"@belte/belte": minor
---

RPC-native durable outbox (local-first writes). Declare `outbox: true` on a mutating rpc (`POST(handler, { outbox: true })`) and an unreachable server — a transport failure or a 502/503/504/52x — parks the request for replay instead of just throwing. The call throws an `HttpError` with `kind === 'queued'` whose `data` is the parked entry (`await (err.data as OutboxEntry).settled` for the eventual outcome). Parked writes are persisted (localStorage), survive reload, and drain FIFO on demand via `rpc.outbox.retry()` or the global `outbox.retry()` — there is no auto-drain; the app owns when to replay. `rpc.outbox()` is the reactive per-rpc queue and the new `belte/browser/outbox` export is the global reactive aggregate; `pending(rpc)` (and `pending(rpc, args)`) now also counts parked writes, so a submit guard works offline. `outbox: true` is mutating-only and must be a build-time literal (enforced by the bundler and a server-side backstop).
