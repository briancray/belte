import { effect } from '../effect.ts'
import { scope } from '../runtime/scope.ts'
import type { EachRow } from './types/EachRow.ts'
import type { SwitchCase } from './types/SwitchCase.ts'

/*
Multi-branch binding — the runtime for `<template switch>`. An effect evaluates
the subject, picks the first case whose `match` equals it (strict `===`), falling
back to the default case (`match` undefined); the chosen branch renders in its own
ownership scope, anchored for placement. Staying on the same branch across a
subject change leaves it mounted (its inner bindings update); switching branches
disposes the old and mounts the new.
*/
// @readme plumbing
export function switchBlock(parent: Node, subject: () => unknown, cases: SwitchCase[]): void {
    const anchor = document.createTextNode('')
    parent.appendChild(anchor)
    let active: EachRow | undefined
    let activeIndex = -1
    effect(() => {
        const value = subject()
        let index = cases.findIndex((entry) => entry.match !== undefined && entry.match() === value)
        if (index === -1) {
            index = cases.findIndex((entry) => entry.match === undefined)
        }
        if (index === activeIndex) {
            return
        }
        if (active !== undefined) {
            active.dispose()
            parent.removeChild(active.node)
            active = undefined
        }
        activeIndex = index
        const chosen = index === -1 ? undefined : cases[index]
        if (chosen === undefined) {
            return
        }
        let node: Node | undefined
        const dispose = scope(() => {
            node = chosen.render(parent)
        })
        active = { node: node as Node, dispose }
        parent.insertBefore(active.node, anchor)
    })
}
