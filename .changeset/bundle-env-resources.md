---
"@briancray/belte": patch
---

Ship the bundle's `.env` under `Contents/Resources/` in a macOS `.app` instead of `Contents/MacOS/`. `codesign` seals `Contents/MacOS/` as code, so a data file there couldn't survive signing and reloading; `Resources` is sealed as a resource. A new `shippedEnvPath` helper centralizes the layout so the build writer and both boot readers agree on the path. The flat (non-macOS) layout is unchanged.
