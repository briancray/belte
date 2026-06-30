---
"@belte/belte": minor
---

`reachable` is now isomorphic. The export moves from `belte/server/reachable` to `belte/shared/reachable` and runs on both sides: in the browser it HEADs the host no-cors. Bare `reachable()` defaults to the app's own server origin — the live origin the page came from on the client, `APP_URL` on the server — making it the active-probe complement to `online()`. Like `online()`, reactivity is opt-in by where you read it: read inside a `$derived`/`$effect` on the client and the scope re-runs when the host flips up or down; call it at a decision point for a one-shot `await reachable()`. Server reads stay one-shot, faithful-first `Promise<boolean>`.
