# ADR-0001: Keep the cache entry lifecycle inline, not behind a transition module

**Status:** accepted (2026-06-09)

## Context

An architecture review proposed concentrating `CacheEntry` state changes
(create, settle, hydrate, defer, invalidate, refresh) into a dedicated
lifecycle module with named transitions, on the theory that the flags
(`settled`, `refreshing`, `value`, `expiresAt`, `invalidation.*`) were
mutated across many files with implicit ordering.

On inspection the premise was weaker than it sounded:

- Every field's invariant is documented once, at the type
  (`lib/shared/types/CacheEntry.ts`), not re-derived per call site.
- The mutation sites are already concentrated by purpose: `registerEntry`
  (cache.ts) owns the settle/ttl/eviction chain, `fireRefetch` owns the
  stale-while-revalidate swap, and the browser-side constructors
  (`cacheEntryFromSnapshot`, `installStreamingPlaceholders`) each build one
  entry shape for one purpose, on the side that owns that concern per the
  `server/` / `browser/` / `shared/` split.
- A transition module would be a one-adapter seam: nothing varies behind it.
  The deletion test fails — deleting it would put three small constructors
  back where the side-split already wants them.
- `cache()` reads sit on the hot path (per-request, per-render); transition
  indirection adds cost with no second caller to amortize it.

## Decision

Do not extract a cache entry lifecycle/transition module. The entry's
invariants live at the type; behavior is enforced by tests through the public
surface instead: `cacheSettled`, `cacheTtlLifecycle`, `cacheInvalidatePolicy`,
`cacheWarmIsolation`, `streamingRoundTrip` (cross-side), and the HTTP-level
`httpServer` / `httpStreaming` suites.

## Consequences

- A new entry mutation site must keep its invariants consistent with the
  `CacheEntry` type doc and add a characterization test at the public surface
  — there is no compiler-enforced transition API to lean on.
- Re-propose only if a second adapter genuinely appears (e.g. a persistent
  cache store with different settle semantics), not for testability — the
  public surface already supports that.
