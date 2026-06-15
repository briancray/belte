import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import type { EachRow } from './types/EachRow.ts'

/*
Conditional binding — the runtime for `<template if>` (with optional `else`). An
effect tracks `condition()` and mounts the matching branch (`render` truthy,
`renderElse` falsy), anchored for placement; only a truthy↔falsy flip swaps.

On hydrate it adopts the branch the server rendered: it runs the matching render
in place (its root claims the existing node), then inserts an anchor after it for
future toggles. The effect's first run sees the same branch and is a no-op; later
toggles (after hydration ends) build fresh. Single-element branches.
*/
// @readme plumbing
export function when(
    parent: Node,
    condition: () => unknown,
    render: (parent: Node) => Node,
    renderElse?: (parent: Node) => Node,
): void {
    const hydration = RENDER.hydration
    let active: EachRow | undefined
    let activeBranch: 'then' | 'else' | undefined
    let anchor: Node

    if (hydration !== undefined) {
        activeBranch = condition() ? 'then' : 'else'
        const chosen = activeBranch === 'then' ? render : renderElse
        if (chosen !== undefined) {
            let node: Node | undefined
            const dispose = scope(() => {
                node = chosen(parent)
            })
            active = { node: node as Node, dispose }
        }
        anchor = document.createTextNode('')
        parent.insertBefore(anchor, claimChild(hydration, parent))
    } else {
        anchor = document.createTextNode('')
        parent.appendChild(anchor)
    }

    effect(() => {
        const branch = condition() ? 'then' : 'else'
        if (branch === activeBranch) {
            return
        }
        if (active !== undefined) {
            active.dispose()
            parent.removeChild(active.node)
            active = undefined
        }
        activeBranch = branch
        const chosen = branch === 'then' ? render : renderElse
        if (chosen === undefined) {
            return
        }
        let node: Node | undefined
        const dispose = scope(() => {
            node = chosen(parent)
        })
        active = { node: node as Node, dispose }
        parent.insertBefore(active.node, anchor)
    })
}
