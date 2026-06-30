---
"@belte/belte": minor
---

Cache options reshape: `scope` → `tags` and `invalidate` → `swr`. Invalidation groups are now declared with `tags: string[]` (was `scope: string | string[]`); `cache.invalidate({ tags })` drops every entry sharing a tag. Stale-while-revalidate is now `swr`: `swr: true` keeps the stale value visible and refetches in the background on every `cache.invalidate` hit (with `refreshing()` reporting the reload, so the reader never blanks), and the object form `swr: { throttle }` / `swr: { debounce }` coalesces a burst of invalidations into far fewer refetches. Replaces the prior `invalidate: { throttle, debounce }`.
