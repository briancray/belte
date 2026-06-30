<script lang="ts">
import { HttpError } from '@belte/belte/shared/HttpError'
import CodeBlock from '$browser/CodeBlock.svelte'
import RpcHeader from '$browser/RpcHeader.svelte'
import { boom } from '$server/rpc/boom.ts'
import { getEcho } from '$server/rpc/getEcho.ts'
import { getProduct } from '$server/rpc/getProduct.ts'
import { reserveProduct } from '$server/rpc/reserveProduct.ts'

let outcome404 = $state('(not triggered)')
let outcome405 = $state('(not triggered)')
let outcome500 = $state('(not triggered)')
let outcomeTyped = $state('(not triggered)')

async function triggerTyped() {
    try {
        await reserveProduct({ id: '1' })
        outcomeTyped = '(no error?)'
    } catch (err) {
        // The per-rpc guard narrows `.kind` and the typed `.data` together.
        if (reserveProduct.isError(err, 'outOfStock')) {
            outcomeTyped = `outOfStock — restock in ${err.data.restockDays}d (status ${err.status})`
        } else {
            outcomeTyped = String(err)
        }
    }
}

async function trigger404() {
    try {
        await getProduct({ id: 'missing' })
        outcome404 = '(no error?)'
    } catch (err) {
        if (err instanceof HttpError) {
            outcome404 = `caught HttpError(${err.status}) — Cache-Control: ${err.response.headers.get('cache-control')}`
        } else {
            outcome404 = String(err)
        }
    }
}

async function trigger405() {
    const response = await fetch(getEcho.url, { method: 'POST' })
    outcome405 = `status=${response.status} Allow=${response.headers.get('allow')}`
}

async function trigger500() {
    try {
        await boom()
        outcome500 = '(no error?)'
    } catch (err) {
        const status = err instanceof HttpError ? err.status : 'unknown'
        outcome500 = `caught HttpError(${status})`
    }
}
</script>

<RpcHeader />
<h1 class="mt-8 text-3xl font-bold"><code class="font-mono">HttpError</code></h1>
<p class="mt-2 text-slate-600">
    Non-2xx comes back through the same call site as the success path.
    <code class="font-mono">HttpError</code>
    carries <code class="font-mono">status</code>,
    <code class="font-mono">statusText</code>, and the raw
    <code class="font-mono">response</code>. All error responses are
    <code class="font-mono">Cache-Control: no-store</code>. A
    <code class="font-mono">error.typed(name, status, schema?)</code>
    constructor adds a named, typed failure the client narrows with
    <code class="font-mono">rpc.isError(caught, name)</code>
    — reading <code class="font-mono">.kind</code> and the typed
    <code class="font-mono">.data</code>
    together.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Error origins</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-medium">status</th>
                    <th class="px-4 py-2 font-medium">source</th>
                    <th class="px-4 py-2 font-medium">notes</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">404</td>
                    <td class="px-4 py-2 text-slate-600">
                        handler returns <code class="font-mono">error(404, …)</code>
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        caught as <code class="font-mono">HttpError</code>
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">405</td>
                    <td class="px-4 py-2 text-slate-600">wrong verb sent to a known URL</td>
                    <td class="px-4 py-2 text-slate-600">
                        framework adds <code class="font-mono">Allow</code> header
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">500</td>
                    <td class="px-4 py-2 text-slate-600">handler throws</td>
                    <td class="px-4 py-2 text-slate-600">
                        routes through <code class="font-mono">app.handleError</code>
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">409</td>
                    <td class="px-4 py-2 text-slate-600">
                        handler returns <code class="font-mono">error.typed(…)</code>
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        narrows to <code class="font-mono">.kind</code> + typed
                        <code class="font-mono">.data</code>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try it</h2>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={trigger404}>
            getProduct({`{ id: 'missing' }`}
            ) → 404
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={trigger405}>
            POST /rpc/getEcho → 405
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={trigger500}>
            boom() → 500
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={triggerTyped}>
            reserveProduct({`{ id: '1' }`}
            ) → 409 outOfStock
        </button>
    </div>
    <ul class="mt-3 space-y-1 font-mono text-xs text-slate-700">
        <li>404:{outcome404}</li>
        <li>405:{outcome405}</li>
        <li>500:{outcome500}</li>
        <li>typed:{outcomeTyped}</li>
    </ul>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/rpc/getProduct.ts — explicit 404"
        code={`import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { error } from '@belte/belte/server/error'

export const getProduct = GET<{ id: string }>(({ id }) => {
    const product = products[id]
    if (!product) return error(404, \`no product with id \${id}\`)
    return json(product)
})`} />

    <CodeBlock
        title="src/server/rpc/boom.ts — thrown error → 500"
        code={`import { GET } from '@belte/belte/server/GET'

export const boom = GET(() => {
    throw new Error('intentional boom — exercising the 500 error path')
})`} />

    <CodeBlock
        title="client — same catch shape for every status"
        code={`import { HttpError } from '@belte/belte/shared/HttpError'

try {
    await getProduct({ id: 'missing' })
} catch (err) {
    if (err instanceof HttpError && err.status === 404) {
        // err.response is the underlying Response
    }
}

// 405 detection without throwing — plain fetch
const response = await fetch(getEcho.url, { method: 'POST' })
// response.status === 405; response.headers.get('allow') === 'GET'`} />

    <CodeBlock
        title="src/server/rpc/reserveProduct.ts — a typed, named failure"
        code={`import { error } from '@belte/belte/server/error'
import { json } from '@belte/belte/server/json'
import { POST } from '@belte/belte/server/POST'
import { z } from 'zod'

// Declare once at module scope; returning it IS the error.
const outOfStock = error.typed('outOfStock', 409, z.object({ id: z.string(), restockDays: z.number() }))

export const reserveProduct = POST(
    ({ id }) => (stock[id] ? json({ id, reserved: true }) : outOfStock({ id, restockDays: 3 })),
    { inputSchema: z.object({ id: z.string() }), clients: { mcp: true } },
)
// The rpc infers its error surface from the returned constructors — no errors: option.`} />

    <CodeBlock
        title="client — narrow .kind and the typed .data together"
        code={`try {
    await reserveProduct({ id: '1' })
} catch (err) {
    if (reserveProduct.isError(err, 'outOfStock')) {
        err.data.restockDays   // typed number, narrowed from the constructor's schema
    }
}`} />
</section>
