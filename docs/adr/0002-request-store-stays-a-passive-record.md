# ADR-0002: RequestStore stays a passive record with documented lazy fields

**Status:** accepted (2026-06-09)

## Context

An architecture review proposed deepening the request scope: a module owning
initialization order, with accessors that assert invariants (e.g. throw when
`params` is read before route dispatch) instead of fields that are silently
`undefined` until populated.

On inspection, the "implicit ordering" is a designed contract, documented at
the type (`lib/server/runtime/types/RequestStore.ts`):

- `route`/`params` are set just before a page render and are *deliberately*
  undefined on rpc/socket requests and during 404/error renders — the page
  resolver maps that window to `''`/`{}` so error views still get a correct
  `page.url` (see serverEntry's resolver comment).
- `cookies` materializes lazily on first `cookies()` call so the common path
  parses nothing; `runWithRequestScope` owns the flush.
- `files` is split off the body by `parseArgs` and is undefined when no file
  parts arrived.

`runWithRequestScope` is already the single seam every dynamic route crosses
— it owns scope creation, error fallback, and cookie flush, and is testable
without a server. Asserting accessors would convert designed-undefined
windows into throws, breaking the error-render path and any consumer relying
on the documented defaults — a behavior change disguised as a refactor, for a
bug class that hasn't manifested.

## Decision

Keep `RequestStore` a passive, documented record. Field semantics live at the
type; the scope lifecycle lives in `runWithRequestScope`. No accessor layer.

## Consequences

- New fields must document their population point and undefined window at the
  type, like the existing fields.
- Re-propose only if a real read-before-init bug class appears; the fix then
  is per-field (a dev-mode assertion at the offending reader), not a wholesale
  accessor module.
