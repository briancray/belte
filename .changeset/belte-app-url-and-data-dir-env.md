---
"@briancray/belte": minor
---

Namespace the CLI's baked env under `BELTE_` and add data-dir controls.

**Breaking:** `APP_URL` → `BELTE_APP_URL` and `APP_TOKEN` → `BELTE_APP_TOKEN`. These are the values baked into a downloaded CLI's `.env` (the hosted server URL, derived from the request origin, plus the bearer token when the download was authenticated) and read by the thin client to resolve its connection target. `BELTE_APP_URL` is now public, documented surface — app code can read it to refer to the app's hosted location. Existing baked binaries and any shell `APP_URL`/`APP_TOKEN` overrides must switch to the prefixed names.

**Added:** `belte/server/appDataDir` — a zero-arg accessor returning the running bundle's per-user data dir, keyed to the same program name belte uses for the user's `.env`/`last-connection.json`, so an app's DB/cache lands beside belte's own config rather than a drifted sibling directory.

**Added:** `BELTE_DATA_DIR` — overrides the data dir on every platform, used as-is. A cross-platform `XDG_DATA_HOME` (which the helper otherwise honours on Linux only), letting dev point at a throwaway dir without touching app code. Must come from a layer above the data-dir `.env` (shell, CWD `.env`, or binary-dir `.env`), since it decides where that file lives.
