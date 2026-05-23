<script lang="ts">
import type { AppState } from './lib/types/AppState.ts'

let { state }: { state: AppState } = $props()
let Layout = $derived.by(() => state.layout)
let Page = $derived.by(() => state.Page)
let params = $derived.by(() => state.params)
</script>

{#if Layout}
    <Layout>
        {#if Page}
            {#key Page}
                <Page {...params} />
            {/key}
        {/if}
    </Layout>
{:else if Page}
    {#key Page}
        <Page {...params} />
    {/key}
{/if}
