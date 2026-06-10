<script lang="ts">
import type { Component } from 'svelte'
import type { Page as PageState } from './lib/browser/page.svelte.ts'

/*
The render tree sits inside a svelte:boundary so a throw during a client page
render reaches onRenderError (handleRenderError — swaps in the nearest
error.svelte). Client-only: the server passes no handler, and an SSR boundary
without a `failed` snippet rethrows, so the server renderPage catch keeps
owning errors there.
*/
let {
    state,
}: {
    state: {
        page: PageState
        render: { Layout: Component | undefined; Page: Component | undefined }
        onRenderError?: (error: unknown, reset: () => void) => void
    }
} = $props()

let Layout = $derived(state.render.Layout)
let PageView = $derived(state.render.Page)
let params = $derived(state.page.params)
</script>

<svelte:boundary onerror={state.onRenderError}>
    {#if Layout}
        <Layout>
            {#if PageView}
                {#key PageView}
                    <PageView {...params} />
                {/key}
            {/if}
        </Layout>
    {:else if PageView}
        {#key PageView}
            <PageView {...params} />
        {/key}
    {/if}
</svelte:boundary>
