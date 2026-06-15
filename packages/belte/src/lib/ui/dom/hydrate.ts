import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'

/*
Adopts existing server-rendered DOM instead of rebuilding it. Runs `build(host)`
with a claim cursor active, so the dom helpers (openChild/appendText/appendStatic)
take the existing nodes rather than creating new ones — attaching event listeners
and reactive effects to the server's markup in place (no re-render, preserved
focus/scroll). Returns a disposer.

Use for static-structure components (elements + text + bindings). Components with
control-flow blocks (if/each/await/switch) or child components should `mount`
instead for now — block adoption is the remaining hydration work.
*/
// @readme plumbing
export function hydrate(host: Element, build: (host: Element) => void): () => void {
    const previous = RENDER.hydration
    RENDER.hydration = { index: new Map() }
    try {
        return scope(() => build(host))
    } finally {
        RENDER.hydration = previous
    }
}
