import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { RESUME } from '../runtime/RESUME.ts'
import { scope } from '../runtime/scope.ts'
import type { EachRow } from './types/EachRow.ts'

/*
Async binding — the runtime for `<template await>`. Renders the pending branch,
then swaps to the resolved branch (with the value) or the error branch on settle.
Each branch builds in its own ownership scope, anchored for correct placement.

Hydration adopts in place, by precedence:
  1. a streamed resume value (`RESUME[id]`, serialized into the stream) → adopt the
     resolved branch the stream already swapped in, no re-fetch;
  2. a warm-sync read (e.g. a warm `belte/shared/cache` entry seeded by the SSR
     cache snapshot) → the promise resolves synchronously, so adopt the SSR branch
     with that value — no flash, no fetch;
  3. otherwise (a genuinely pending read with no resume value) → discard the SSR
     boundary and run fresh.

Cache-compatible by the warm-sync rule: `belte/shared/cache` returns a settled
value synchronously for a warm key and a Promise otherwise. A non-thenable result
renders the resolved branch immediately — no pending flash — matching the cache's
warm-read contract; only a real Promise shows pending and resolves on a microtask.
*/
// @readme plumbing
export function awaitBlock(
    parent: Node,
    id: number,
    promiseThunk: () => unknown,
    renderPending: ((parent: Node) => Node) | undefined,
    renderThen: (parent: Node, value: unknown) => Node,
    renderCatch: (parent: Node, error: unknown) => Node,
): void {
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        /* Cursor sits on the `<!--belte:await:id-->` open marker. */
        const open = claimChild(hydration, parent)
        const entry = RESUME[id]
        if (entry !== undefined) {
            /* (1) streamed resume value → adopt the resolved branch in place. */
            adoptResolved(hydration, parent, open, () =>
                entry.ok ? renderThen(parent, entry.value) : renderCatch(parent, entry.error),
            )
            return
        }
        const result = promiseThunk()
        if (!isThenable(result)) {
            /* (2) warm-sync read (warm cache) → adopt the SSR branch with the value. */
            adoptResolved(hydration, parent, open, () => renderThen(parent, result))
            return
        }
        /* (3) genuinely pending, no resume value → drop the SSR boundary, run fresh. */
        discardBoundary(parent, open, `/belte:await:${id}`, hydration)
        mountAwait(parent, result, renderPending, renderThen, renderCatch)
        return
    }

    mountAwait(parent, promiseThunk(), renderPending, renderThen, renderCatch)
}

/* Whether a value is a Promise-like (the cold path); a non-thenable is warm-sync. */
function isThenable(value: unknown): value is Promise<unknown> {
    return value !== null && typeof (value as { then?: unknown })?.then === 'function'
}

/* Anchored pending→resolved swapping for a fresh (non-adopted) await. A non-thenable
   `result` renders the resolved branch immediately (warm-sync, no pending flash). */
function mountAwait(
    parent: Node,
    result: unknown,
    renderPending: ((parent: Node) => Node) | undefined,
    renderThen: (parent: Node, value: unknown) => Node,
    renderCatch: (parent: Node, error: unknown) => Node,
): void {
    const anchor = document.createTextNode('')
    parent.appendChild(anchor)
    let active: EachRow | undefined

    const swap = (render: (() => Node) | undefined): void => {
        if (active !== undefined) {
            active.dispose()
            parent.removeChild(active.node)
            active = undefined
        }
        if (render === undefined) {
            return
        }
        let node: Node | undefined
        const dispose = scope(() => {
            node = render()
        })
        active = { node: node as Node, dispose }
        parent.insertBefore(active.node, anchor)
    }

    if (!isThenable(result)) {
        swap(() => renderThen(parent, result)) // warm-sync value → resolved now, no pending flash
        return
    }
    swap(renderPending === undefined ? undefined : () => renderPending(parent))
    result.then(
        (value) => swap(() => renderThen(parent, value)),
        (error) => swap(() => renderCatch(parent, error)),
    )
}

/* Adopt an SSR-resolved branch sitting between the boundary markers: step the
   hydration cursor past the open marker, build the branch (claiming the resolved
   nodes in place), then step past the close marker. */
function adoptResolved(
    hydration: NonNullable<(typeof RENDER)['hydration']>,
    parent: Node,
    open: Node | null,
    render: () => Node,
): void {
    hydration.next.set(parent, open?.nextSibling ?? null)
    render()
    const close = claimChild(hydration, parent)
    hydration.next.set(parent, close?.nextSibling ?? null)
}

/* Remove the SSR boundary — open marker through close marker (inclusive) — and
   park the hydration cursor on the node after it, so a fresh run replaces it
   without duplicating the server's pending shell. */
function discardBoundary(
    parent: Node,
    open: Node | null,
    closeData: string,
    hydration: NonNullable<(typeof RENDER)['hydration']>,
): void {
    let node = open
    let after: Node | null = null
    while (node !== null) {
        const next = node.nextSibling
        const isClose = (node as { data?: string }).data === closeData
        parent.removeChild(node)
        if (isClose) {
            after = next
            break
        }
        node = next
    }
    hydration.next.set(parent, after)
}
