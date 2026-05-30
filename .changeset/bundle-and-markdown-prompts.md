---
"@briancray/belte": minor
---

Add a `belte bundle` desktop app and make the CLI a thin remote-only client.

- `belte bundle` assembles a movable, self-contained desktop app (a `.app` on macOS, a flat dir elsewhere) that boots into a connect screen — start the embedded server or connect to a remote one by URL.
- **Breaking:** the CLI binary is now always a thin remote client (talks to a running server over HTTP, `APP_URL` required). Dropped the `--thin`/full split and in-process fallback — use `belte bundle` for the embedded-backend case.
- **Breaking:** MCP prompts are now markdown files (`src/mcp/prompts/**.md`) with YAML frontmatter, replacing the `.ts` prompt modules.
- **Breaking:** handlers read the inbound request via `request()` and the live server via `server()` rather than `RequestStore` fields.
- `json` / `jsonl` / `sse` / `error` / `redirect` accept a trailing `ResponseInit`.
- Static-asset header caching is shared across asset servers, and zstd decompression moved to the async API.
