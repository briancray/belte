---
"@briancray/belte": patch
---

RPC, socket, and prompt codegen now emit imports under the name belte is installed as in the consuming project — the canonical `@briancray/belte` for a direct dependency, or the alias key for a package alias (`"belte": "npm:@briancray/belte@..."`) — instead of a hardcoded `belte`. A plain `bun add @briancray/belte` now builds with no alias required; the `belte` alias remains supported for the bare `belte/...` import surface.
