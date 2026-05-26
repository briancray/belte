<script lang="ts">
import CodeBlock from '$lib/CodeBlock.svelte'

let toolsList = $state('(not called)')
let toolsCall = $state('(not called)')

async function listTools() {
    const response = await fetch('/__belte/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    toolsList = JSON.stringify(await response.json(), undefined, 2)
}

async function callGetEcho() {
    const response = await fetch('/__belte/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'getEcho', arguments: { message: 'hello from /__belte/mcp' } },
        }),
    })
    toolsCall = JSON.stringify(await response.json(), undefined, 2)
}
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">belte/mcp</code></h1>
<p class="mt-2 text-slate-600">
    Auto-mounted at <code class="font-mono">POST /__belte/mcp</code> — JSON-RPC 2.0, MCP
    protocol <code class="font-mono">2025-06-18</code>. Tools and resources are derived from
    the same rpcs and sockets the browser already uses; no second registry to maintain.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Derivation rules</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-medium">source</th>
                    <th class="px-4 py-2 font-medium">becomes</th>
                    <th class="px-4 py-2 font-medium">when</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 text-slate-600">rpc with <code class="font-mono">schema</code></td>
                    <td class="px-4 py-2 font-mono text-slate-500">tool &lt;name&gt;</td>
                    <td class="px-4 py-2 text-slate-600"><code class="font-mono">clients.mcp</code> auto-flips on with schema</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 text-slate-600">socket with <code class="font-mono">schema</code></td>
                    <td class="px-4 py-2 font-mono text-slate-500">tool await_&lt;name&gt;</td>
                    <td class="px-4 py-2 text-slate-600">blocks for the next published entry (default 30000ms)</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 text-slate-600">socket with <code class="font-mono">clientPublish</code></td>
                    <td class="px-4 py-2 font-mono text-slate-500">tool publish_&lt;name&gt;</td>
                    <td class="px-4 py-2 text-slate-600">payload validated by the socket's schema</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 text-slate-600">socket history</td>
                    <td class="px-4 py-2 font-mono text-slate-500">belte://stream/&lt;name&gt;</td>
                    <td class="px-4 py-2 text-slate-600">resource — latest history window as JSON</td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        No schema → no MCP exposure. The schema is the gate that makes the non-browser
        surfaces safe to advertise. Override per-declaration with
        <code class="font-mono">{`{ clients: { mcp: false } }`}</code>.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try it</h2>
    <p class="mt-1 text-xs text-slate-500">
        Hits the endpoint at <code class="font-mono">POST /__belte/mcp</code>
        directly from the browser. The schema-bearing kitchen-sink rpcs
        (<code class="font-mono">getEcho</code>, <code class="font-mono">createEcho</code>,
        <code class="font-mono">getProduct</code>, <code class="font-mono">publishChat</code>)
        plus the <code class="font-mono">chat</code> socket all appear in
        <code class="font-mono">tools/list</code>.
    </p>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={listTools}>
            tools/list
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={callGetEcho}>
            tools/call → getEcho
        </button>
    </div>
    <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
            <p class="text-xs font-medium text-slate-500">tools/list</p>
            <pre class="mt-1 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"><code
                >{toolsList}</code></pre>
        </div>
        <div>
            <p class="text-xs font-medium text-slate-500">tools/call</p>
            <pre class="mt-1 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"><code
                >{toolsCall}</code></pre>
        </div>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Auth forwarding</h2>
    <p class="mt-1 text-sm text-slate-600">
        Inbound MCP requests forward <code class="font-mono">cookie</code>,
        <code class="font-mono">authorization</code>,
        <code class="font-mono">x-forwarded-for</code>,
        <code class="font-mono">x-forwarded-proto</code> onto every synthesized rpc request,
        so the session middleware in <code class="font-mono">src/app.ts</code> keeps working
        unchanged. Tool calls go through the same <code class="font-mono">verb.fetch</code>
        path as the HTTP route — validation, response helpers, and error mapping behave
        identically.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900">Streaming caveat</h2>
    <p class="mt-1">
        MCP gets single-shot <code class="font-mono">await_&lt;name&gt;</code>
        plus snapshot resources — not a live subscription. Real-time fan-out stays on the
        <a class="underline" href="/server/sockets">ws multiplex</a> for now.
    </p>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/mcp.ts — optional customisation"
        code={`import { createMcpServer } from 'belte/mcp/createMcpServer'
import { HttpError } from 'belte/server/HttpError'

export default createMcpServer({
    name: 'kitchen-sink',
    version: '0.0.1',
    // authorize: (req) => {
    //     if (!req.headers.get('authorization')) {
    //         throw new HttpError(401, 'mcp requires bearer token')
    //     }
    // },
})`} />

    <CodeBlock
        title="from a shell — call any tool"
        lang="sh"
        code={`curl -sX POST http://localhost:3000/__belte/mcp \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"getEcho","arguments":{"message":"hi"}}}'`} />
</section>
