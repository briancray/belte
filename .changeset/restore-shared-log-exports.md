---
"@briancray/belte": patch
---

Restore `belte/shared/log` as a public export. The 0.11 switch from `./shared/*` globs to an explicit allowlist dropped this isomorphic utility along with the genuinely-internal machinery: `log` is the framework's `[belte]` logger (browser + server, color-aware, with `log.debug(scope, message)` gated by `DEBUG`), documented public surface rather than an internal, so it is listed again. The `isDebugEnabled` matcher stays internal — `log.debug` already gates on it, so consumers reach for `log.debug`/`console.debug`, never the matcher directly.
