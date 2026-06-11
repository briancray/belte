---
'@belte/belte': patch
---

fix(url): keep `[name]` params declared before a `[...rest]` catch-all in `PathParams` — the catch-all branch swallowed its head, so `url('/media/[id]/[...rest]', { id, rest })` rejected `id`
