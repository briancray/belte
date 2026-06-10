import type { Component } from 'svelte'

/*
Manifest of directory prefix → error.svelte module loader. The deepest prefix
that is an ancestor of the failed path wins (nearest-only, like layouts). An
error.svelte renders in place of the page for an unknown route (404, server)
or a throw during a page render (500 — the server renderPage catch and the
client boundary apply the same contract); the component receives
`{ status, message, stack }` props.
*/
export type Errors = Record<string, () => Promise<{ default: Component }>>
