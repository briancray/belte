---
'@belte/belte': patch
---

fix(belte): `json(undefined)` returns 204 No Content instead of throwing

`Response.json(undefined)` throws TypeError because JSON has no encoding for
`undefined`, so any handler returning `json(undefined)` — e.g. a
`Shape | undefined` route signalling "not found" — 500ed instead of degrading.
`json()` now emits 204 No Content for `undefined`, which `decodeResponse`
already maps back to `undefined` on both the fetch and in-process paths, so
the `Shape | undefined` RPC contract round-trips the wire. The helper owns
the 204; it wins over any `init.status`.
