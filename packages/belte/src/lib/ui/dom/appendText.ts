import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'

/*
A reactive text node under `parent`: created and appended (create mode), or the
existing server-rendered text node claimed (hydrate mode) and bound for future
updates. Adjacent SSR text merges into one node, so on hydrate the claimed node is
split at the current value's length — deterministic, because `read()` returns the
same value the server rendered — leaving exactly this node's text to bind and the
remainder as the next claim.
*/
// @readme plumbing
export function appendText(parent: Node, read: () => unknown): void {
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        const node = claimChild(hydration, parent) as unknown as Text
        const value = String(read())
        if (node !== null && value.length < node.data.length) {
            node.splitText(value.length)
        }
        hydration.next.set(parent, node === null ? null : node.nextSibling)
        effect(() => {
            node.data = String(read())
        })
        return
    }
    const node = document.createTextNode('')
    parent.appendChild(node)
    effect(() => {
        node.data = String(read())
    })
}
