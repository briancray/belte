import { effect } from '../effect.ts'
import { scope } from '../runtime/scope.ts'
import type { EachRow } from './types/EachRow.ts'

/*
Conditional binding — the runtime for `<template if>` (with optional `else`). An
effect tracks `condition()` and mounts the matching branch (`render` when truthy,
`renderElse` when falsy) in its own ownership scope, anchored for placement. While
the branch stays the same it isn't re-rendered — its inner bindings update; only a
truthy↔falsy flip disposes one branch and mounts the other. Single-element
branches (each returns one node), mirroring `each`'s row.
*/
// @readme plumbing
export function when(
    parent: Node,
    condition: () => unknown,
    render: () => Node,
    renderElse?: () => Node,
): void {
    const anchor = document.createTextNode('')
    parent.appendChild(anchor)
    let active: EachRow | undefined
    let activeBranch: 'then' | 'else' | undefined
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
            node = chosen()
        })
        active = { node: node as Node, dispose }
        parent.insertBefore(active.node, anchor)
    })
}
