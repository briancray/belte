---
"@belte/belte": patch
---

fix(ssr): set `navigating: false` on the server-rendered page state. 0.28.0's client-side `navigate` made `navigating` a required field of the page snapshot, but `createPageRenderer`'s two SSR literals (normal render + error render) were never updated, so a strict consumer `bun check` (belte ships raw TS) failed with `Property 'navigating' is missing`. SSR has no client transition, so it's always settled — mirrors `resolvePageSnapshot`.
