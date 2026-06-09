<script lang="ts">
import { cache } from '../../../../src/lib/shared/cache.ts'
import { fastData } from '../rpc/fastData.ts'

/* Awaited read: render blocks on it, so it settles and ships inline in __SSR__. */
const data = await cache(fastData)()
</script>

<p data-page="settled">settled-{data.n}</p>
