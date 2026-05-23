import type { AppState } from '../types/AppState.ts'

// $state is intentionally mutable — Svelte reactivity model requires it
export const nav: AppState = $state({
    layout: undefined,
    Page: undefined,
    params: {},
})
