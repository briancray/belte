<script lang="ts">
import { tail } from '@belte/belte/browser/tail'
import CodeBlock from '$browser/CodeBlock.svelte'
import { publishChat } from '$server/rpc/publishChat.ts'
import { chat } from '$server/sockets/chat.ts'

const latest = $derived(tail(chat))

let from = $state('alice')
let text = $state('hello socket!')
async function send() {
    await publishChat({ from, text })
}

/*
The socket's HTTP face at /__belte/sockets/<name> — what the CLI and MCP
use instead of the ws multiplex. GET returns the retained tail as JSON
(SSE with Accept: text/event-stream); POST publishes, gated by
clientPublish — off here, so it 403s.
*/
let restTail = $state('(not fetched)')
let restPublish = $state('(not tried)')

async function fetchRestTail() {
    const response = await fetch('/__belte/sockets/chat?tail=3')
    restTail = JSON.stringify(await response.json(), undefined, 2)
}

async function tryRestPublish() {
    const response = await fetch('/__belte/sockets/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'x', from: 'rest', text: 'hi', at: Date.now() }),
    })
    restPublish = `${response.status} ${await response.text()}`
}
</script>

<h1 class="text-3xl font-bold">Sockets</h1>
<p class="mt-2 text-slate-600">
    One topic per file under <code class="font-mono">src/server/sockets/</code>. A
    <code class="font-mono">Socket&lt;T&gt;</code>
    is an isomorphic <code class="font-mono">AsyncIterable&lt;T&gt;</code>
    — every socket multiplexes onto one ws at
    <code class="font-mono">/__belte/sockets</code>.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Options</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">option</th>
                    <th class="px-4 py-2 font-medium">default</th>
                    <th class="px-4 py-2 font-medium">effect</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">tail</td>
                    <td class="px-4 py-2 font-mono text-slate-500">0</td>
                    <td class="px-4 py-2 text-slate-600">
                        retain the last N frames; late joiners seed via
                        <code class="font-mono">chat.tail(count?)</code>
                        — 0 = pure live pipe
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">ttl</td>
                    <td class="px-4 py-2 font-mono text-slate-500">undefined</td>
                    <td class="px-4 py-2 text-slate-600">
                        retained frames older than <code class="font-mono">ttl</code> ms are evicted
                        lazily
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">clientPublish</td>
                    <td class="px-4 py-2 font-mono text-slate-500">false</td>
                    <td class="px-4 py-2 text-slate-600">browsers may publish only when set</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">schema</td>
                    <td class="px-4 py-2 font-mono text-slate-500">undefined</td>
                    <td class="px-4 py-2 text-slate-600">
                        Standard Schema validating publishes (sync only);
                        <code class="font-mono">T</code>
                        infers from it and the mcp/cli surfaces flip on
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">clients</td>
                    <td class="px-4 py-2 font-mono text-slate-500">browser-only</td>
                    <td class="px-4 py-2 text-slate-600">
                        per-surface exposure, same shape as rpc; all surfaces when a schema is
                        present
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try it</h2>
    <p class="mt-1 text-xs text-slate-500">
        <code class="font-mono">chat</code>
        has <code class="font-mono">clientPublish: false</code> — publishes route through
        <code class="font-mono">publishChat</code>
        (POST) so the server can validate first.
    </p>
    <div class="mt-3 flex flex-wrap items-end gap-2">
        <label class="text-xs font-medium">
            from
            <input
                bind:value={from}
                class="mt-1 block rounded-md border border-slate-300 px-3 py-1.5 text-sm">
        </label>
        <label class="flex-1 text-xs font-medium">
            text
            <input
                bind:value={text}
                class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm">
        </label>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={send}>
            publish
        </button>
    </div>
    {#if latest}
        <pre
            class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
            >{JSON.stringify(latest, undefined, 2)}</code></pre>
    {:else}
        <p class="mt-3 text-xs text-slate-500">(no message yet — publish something)</p>
    {/if}
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">
        The HTTP face — <code class="font-mono">/__belte/sockets/&lt;name&gt;</code>
    </h2>
    <p class="mt-1 text-xs text-slate-500">
        For clients that can't speak the ws multiplex (the CLI and MCP read through it):
        <code class="font-mono">GET</code>
        returns the retained tail — JSON array by default, a live SSE stream with
        <code class="font-mono">Accept: text/event-stream</code>
        (<code class="font-mono">?tail=N</code>
        caps/seeds);
        <code class="font-mono">POST</code>
        publishes the JSON body, gated by <code class="font-mono">clientPublish</code> and validated
        against the schema. <code class="font-mono">chat</code> keeps
        <code class="font-mono">clientPublish</code>
        off, so the POST below 403s.
    </p>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={fetchRestTail}>
            GET /__belte/sockets/chat?tail=3
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={tryRestPublish}>
            POST /__belte/sockets/chat → 403
        </button>
    </div>
    <pre
        class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
        >tail: {restTail}
publish: {restPublish}</code></pre>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/sockets/chat.ts"
        code={`import { socket } from '@belte/belte/server/socket'
import { z } from 'zod'

const schema = z.object({
    id: z.string(),
    from: z.string(),
    text: z.string(),
    at: z.number(),
})

// retain the last 100 frames, evict any older than an hour; the schema
// validates publishes (sync only), infers the frame type, and flips mcp/cli on
export const chat = socket({ schema, tail: 100, ttl: 3_600_000 })

export type ChatMessage = z.infer<typeof schema>`} />

    <CodeBlock
        title="src/server/rpc/publishChat.ts — validated publish path"
        code={`import { POST } from '@belte/belte/server/POST'
import { error } from '@belte/belte/server/error'
import { json } from '@belte/belte/server/json'
import { chat, type ChatMessage } from '$server/sockets/chat.ts'

export const publishChat = POST<{ from: string; text: string }>(({ from, text }) => {
    if (!from.trim() || !text.trim()) return error(400, 'from and text required')
    const message: ChatMessage = { id: crypto.randomUUID(), from, text, at: Date.now() }
    chat.publish(message)
    return json(message)
})`} />

    <CodeBlock
        title="iteration — works the same on both sides"
        code={`for await (const m of chat)         { /* live stream — no replay */ }
for await (const m of chat.tail())   { /* whole retained tail, then live */ }
for await (const m of chat.tail(20)) { /* last 20 (clamped to the retained tail), then live */ }`} />

    <CodeBlock
        title="this page — reactive read"
        code={`import { tail } from '@belte/belte/browser/tail'
import { chat } from '$server/sockets/chat.ts'

const latest = $derived(tail(chat))     // re-renders on every new frame`} />
</section>
