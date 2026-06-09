<script lang="ts">
import { cache } from '../../../../src/lib/shared/cache.ts'
import { slowData } from '../rpc/slowData.ts'

/* {#await} read: render emits the pending branch without blocking, so the
   entry stays pending and streams over the out-of-band resolve channel. */
const read = cache(slowData)
</script>

{#await read()}
    <p data-pending>loading</p>
{:then data}
    <p data-done>{data.n}</p>
{/await}
