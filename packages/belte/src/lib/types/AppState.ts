import type { Component } from 'svelte'

/*
Active layout + page + params for the current render. Single layout per
render (the nearest leaf-upward layout.svelte); no stacking.
*/
export type AppState = {
    layout: Component | undefined
    Page: Component | undefined
    params: Record<string, string>
}
