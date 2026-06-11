---
"@belte/belte": patch
---

Hidden tabs release their long-lived connections instead of holding them open. The dev live-reload EventSource and the multiplexed sockets WebSocket both close on `visibilitychange: hidden` and reconnect on visible, riding the existing drop paths: the reload client re-captures the worker fingerprint on reconnect (a rebuild while the tab slept still reloads it), and socket consumers resync through the typed disconnect — their fresh sub frames queue while hidden and flush when the tab returns. Backgrounded tabs no longer accumulate idle connections the browser throttles or the server counts against per-host limits.
