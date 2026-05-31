---
"@briancray/belte": patch
---

Public asset paths are snapshotted on disk at boot rather than stat'd per request, and browser-only routes are logged at startup.
