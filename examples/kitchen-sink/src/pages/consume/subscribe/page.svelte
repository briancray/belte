<script lang="ts">
import CodeBlock from '$lib/CodeBlock.svelte'
import { subscribe } from 'belte/consume'
import { tickFeed } from '$route/tickFeed.ts'
import { countLog } from '$route/countLog.ts'
import { chatFeed } from '$route/chatFeed.ts'
import { publishChat } from '$route/publishChat.ts'

/*
subscribe(fn)(args) returns the latest frame from a stream as a reactive
value. The first $derived read in a tracking scope opens the stream; the
last reader to drop closes it. Args change → old reader released, new
stream opened under a new key.

subscribe is a no-op on the server — SSR can't keep streams open across
the request boundary. Pages that want a value in the initial HTML should
seed via `cache(fn)()` and add `subscribe(fn)()` for live updates.
*/
const sseLatest = $derived(subscribe(tickFeed)())
const sseStatus = $derived(subscribe.status(tickFeed)())

let jsonlActive = $state(false)
const jsonlLatest = $derived(jsonlActive ? subscribe(countLog)({ to: 20 }) : undefined)
const jsonlStatus = $derived(jsonlActive ? subscribe.status(countLog)({ to: 20 }) : 'pending')

const chatLatest = $derived(subscribe(chatFeed)())

let from = $state('alice')
let text = $state('hello from /consume/subscribe')
async function send() {
    await publishChat({ from, text })
}
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">subscribe()</code></h1>
<p class="mt-2 text-slate-600">
    Reactive consumer for remote streams. Works the same against an
    <code class="font-mono">sse(...)</code>
    handler, a <code class="font-mono">jsonl(...)</code>
    handler, or a <code class="font-mono">SOCKET</code>
    route — the call site never changes.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">SSE — <code class="font-mono">tickFeed</code></h2>
    <p class="mt-1 text-sm text-slate-600">
        Always-on subscription; closes the moment you navigate away.
    </p>
    <p class="mt-3 font-mono text-xs text-slate-700">status: {sseStatus}</p>
    {#if sseLatest}
        <p class="mt-1 font-mono text-xs text-slate-700">latest: tick={sseLatest.tick} at={sseLatest.at}</p>
    {:else}
        <p class="mt-1 font-mono text-xs text-slate-500">(no frame yet)</p>
    {/if}
    <CodeBlock
        title="src/route/tickFeed.ts (server — same handler as the streaming-helpers demo)"
        code={`export const tickFeed = GET<undefined, { tick: number; at: string }>(() =>
    sse(async function* () {
        for (let tick = 1; ; tick += 1) {
            yield { tick, at: new Date().toISOString() }
            await Bun.sleep(1000)
        }
    }()),
)`} />
    <CodeBlock
        title="this page (client)"
        code={`import { subscribe } from 'belte/consume'

const sseLatest = $derived(subscribe(tickFeed)())     // latest frame
const sseStatus = $derived(subscribe.status(tickFeed)()) // 'pending' | 'open' | 'done' | 'error'`} />
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">JSONL — <code class="font-mono">countLog</code></h2>
    <p class="mt-1 text-sm text-slate-600">
        Toggle the subscription to see the lifecycle — the stream opens on first read and
        closes when the last $derived stops reading it.
    </p>
    <button
        type="button"
        class="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={() => { jsonlActive = !jsonlActive }}>
        {jsonlActive ? 'unsubscribe' : 'subscribe'}
    </button>
    <p class="mt-3 font-mono text-xs text-slate-700">status: {jsonlStatus}</p>
    {#if jsonlLatest}
        <p class="mt-1 font-mono text-xs text-slate-700">latest n: {jsonlLatest.n}</p>
    {/if}
    <CodeBlock
        title="this page (client) — conditional subscription"
        code={`/* Reading subscribe(...) inside $derived only opens the stream while
   the deriving scope is alive. Gate behind a $state flag to demo
   open-on-first-read / close-on-last-reader. */
let jsonlActive = $state(false)
const jsonlLatest = $derived(jsonlActive ? subscribe(countLog)({ to: 20 }) : undefined)`} />
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">SOCKET — <code class="font-mono">chatFeed</code></h2>
    <p class="mt-1 text-sm text-slate-600">
        Multiplexed onto <code class="font-mono">/__belte/socket</code>. Publish from here
        (or from <a class="underline" href="/respond/request-and-server">/respond/request-and-server</a>)
        and every subscriber re-renders.
    </p>
    <div class="mt-3 flex flex-wrap items-end gap-2">
        <label class="text-xs font-medium">
            from
            <input
                bind:value={from}
                class="mt-1 block rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        </label>
        <label class="flex-1 text-xs font-medium">
            text
            <input
                bind:value={text}
                class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        </label>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={send}>
            publish
        </button>
    </div>
    {#if chatLatest}
        <pre class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
            >{JSON.stringify(chatLatest, undefined, 2)}</code></pre>
    {:else}
        <p class="mt-3 text-xs text-slate-500">(no frame yet — publish something)</p>
    {/if}
    <CodeBlock
        title="src/route/chatFeed.ts (server)"
        code={`import { SOCKET } from 'belte/route'
import { watchChat, type ChatMessage } from '../chatState.ts'

export const chatFeed = SOCKET<undefined, ChatMessage>(async function* () {
    for await (const message of watchChat()) {
        yield message
    }
})`} />
    <CodeBlock
        title="this page (client) — subscribe + publish over the same broadcast"
        code={`import { subscribe } from 'belte/consume'

const chatLatest = $derived(subscribe(chatFeed)())   // same shape regardless of transport

async function send() {
    await publishChat({ from, text })   // POST that fan-outs through the SOCKET
}`} />
</section>
