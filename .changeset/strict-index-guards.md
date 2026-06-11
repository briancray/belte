---
'@belte/belte': patch
---

fix: type-check cleanly under strict consumer flags — belte ships raw TS, so app-side tsconfig flags type-check it. Bind layout/error loaders before invoking (`noUncheckedIndexedAccess`), pin asset/tarball bytes to `Uint8Array<ArrayBuffer>` so they satisfy `BodyInit`, cast the FFI window handle to `Pointer`, and add `erasableSyntaxOnly` to the shipped `tsconfig.app.json`
