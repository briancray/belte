---
"@briancray/belte": minor
---

`belte bundle` now ad-hoc code-signs the assembled macOS `.app` so it launches on other Macs instead of being silently killed by Gatekeeper. A quarantined copy may still need `xattr -cr` once; full distribution still requires a Developer ID signature and notarization.
