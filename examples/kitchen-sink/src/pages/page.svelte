<script lang="ts">
/*
Kitchen-sink index. The four primitives — route, stream, respond,
consume — each get a card. Route + stream are how things are
declared; respond is what runs per-request; consume is how the client
reads.
*/
</script>

<h1 class="text-3xl font-bold">belte kitchen-sink</h1>
<p class="mt-2 text-slate-600">
    Working demos of every primitive in the framework, organised by
    lifecycle phase: <code class="font-mono">belte/route</code>
    and <code class="font-mono">belte/stream</code>
    for declaration, <code class="font-mono">belte/respond</code>
    for what runs per-request, and
    <code class="font-mono">belte/consume</code> for the client.
</p>

<section class="mt-8 grid gap-4 sm:grid-cols-2">
    <a
        href="/route"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">Route</h2>
        <p class="mt-1 text-sm text-slate-600">
            HTTP verbs declared by file name. Pages, layouts, dynamic segments, and verb-bound
            rpcs.
        </p>
    </a>
    <a
        href="/stream"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">Stream</h2>
        <p class="mt-1 text-sm text-slate-600">
            Named broadcast topics multiplexed onto one framework-owned ws. Publish and
            subscribe from either side, history replay, server-only or
            <code class="font-mono">clientPublish</code> opt-in.
        </p>
    </a>
    <a
        href="/respond"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">Respond</h2>
        <p class="mt-1 text-sm text-slate-600">
            What runs when a request lands. Response helpers, the request scope, the server
            proxy, streaming wrappers, and the error path.
        </p>
    </a>
    <a
        href="/consume"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">Consume</h2>
        <p class="mt-1 text-sm text-slate-600">
            How the client reads, reacts, and navigates.
            <code class="font-mono">cache()</code>
            , <code class="font-mono">subscribe()</code>
            , <code class="font-mono">.raw</code>, and
            <code class="font-mono">page</code> + <code class="font-mono">navigate</code>.
        </p>
    </a>
</section>

<section class="mt-10 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-lg font-semibold">Composed showcase: cookie-session auth</h2>
    <p class="mt-1 text-sm text-slate-600">
        <a class="underline" href="/auth/dashboard">/auth/dashboard</a>
        is gated by a nested layout. The
        <code class="font-mono">auth/layout.svelte</code>
        <em>replaces</em>
        the root layout for everything under <code class="font-mono">/auth</code>
        (layouts are nearest-only), so the auth area renders its own chrome.
    </p>
</section>
