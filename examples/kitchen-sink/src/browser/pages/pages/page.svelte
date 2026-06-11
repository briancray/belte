<script lang="ts">
import { navigate } from '@belte/belte/browser/navigate'
import { page } from '@belte/belte/browser/page'
import { url } from '@belte/belte/shared/url'
import CodeBlock from '$browser/CodeBlock.svelte'

/*
`page.url` is reassigned on every navigation, so reading it inside a
$derived re-runs the scope — no per-link plumbing.
*/
const currentPath = $derived(page.url.pathname)
const navigating = $derived(page.navigating)

/*
url(path, …) resolves three disjoint path kinds off the path itself:
  - an rpc path (/rpc/*) takes the verb's args, serialised to a query;
  - a page route ([id] segments) takes its params, then an optional query;
  - a bare asset / paramless path takes an optional query.
Scheme-qualified or protocol-relative URLs pass through untouched. When the
app mounts under APP_URL's subpath, every rooted result carries that base —
links built here stay inside the mount with no per-link plumbing.
*/
let productId = $state('2')
const rpcHref = $derived(url('/rpc/getProduct', { id: productId }))
const pageHref = $derived(url('/pages/product/[id]', { id: productId }))
const assetHref = $derived(url('/robots.txt'))
const externalHref = $derived(url('https://bun.sh', { utm: 'belte' }))
</script>

<h1 class="text-3xl font-bold">Pages</h1>
<p class="mt-2 text-slate-600">
    Every folder under <code class="font-mono">src/browser/pages/</code> with a
    <code class="font-mono">page.svelte</code>
    is a route. <code class="font-mono">pages/post/[id]/page.svelte</code> →
    <code class="font-mono">/post/[id]</code>;
    <code class="font-mono">[...rest]</code>
    catches all.
    <code class="font-mono">layout.svelte</code>
    wraps its subtree — nearest ancestor only, no stacking — and
    <code class="font-mono">error.svelte</code>
    is the subtree's failure boundary.
</p>

<section class="mt-6">
    <div class="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-medium">demo</th>
                    <th class="px-4 py-2 font-medium">shows</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2">
                        <a class="underline" href="/pages/product/1">/pages/product/[id]</a>
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        a dynamic <code class="font-mono">[id]</code> segment, typed via the
                        generated <code class="font-mono">Routes</code> interface
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2">
                        <a class="underline" href="/auth/dashboard">/auth/dashboard</a>
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        nearest-only layouts — <code class="font-mono">auth/layout.svelte</code>
                        replaces the root layout for its subtree
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2">
                        <a class="underline" href="/pages/boundary?explode=1">
                            /pages/boundary?explode=1
                        </a>
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        <code class="font-mono">error.svelte</code>
                        catching a render throw — the nearest boundary renders with
                        <code class="font-mono">{'{ status, message, stack }'}</code>
                        props
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2">
                        <a class="underline" href="/pages/no-such-page">/pages/no-such-page</a>
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        the same boundary rendering an unknown route as a 404
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">
        <code class="font-mono">page</code>
        + <code class="font-mono">navigate</code>
    </h2>
    <p class="mt-1 text-sm text-slate-600">
        <code class="font-mono">page</code>
        is reactive page state — <code class="font-mono">route</code>,
        <code class="font-mono">params</code>, <code class="font-mono">url</code>,
        <code class="font-mono">navigating</code>. Same-pathname navigations (search/hash) skip the
        fetch and remount; non-SPA targets fall back to a hard navigation.
    </p>
    <p class="mt-3 font-mono text-sm text-slate-700">
        page.url.pathname = <strong>{currentPath}</strong>
        {#if navigating}
            <span class="text-amber-600">(navigating…)</span>
        {/if}
    </p>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => navigate('/pages/product/1')}>
            navigate('/pages/product/1')
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => navigate('/pages', { replace: true })}>
            navigate('/pages',{`{ replace: true }`}
            )
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => navigate(`/pages?ts=${Date.now()}`, { scroll: false })}>
            same pathname — no fetch, no remount
        </button>
    </div>
</section>

<section class="mt-6">
    <h2 class="text-sm font-semibold">
        <code class="font-mono">url()</code>
        — typed, base-correct links
    </h2>
    <p class="mt-1 text-sm text-slate-600">
        One builder for every in-app URL — page links, asset refs, and rpc hrefs. It reads the path
        to pick a resolution: an
        <a class="underline" href="/rpc"><code class="font-mono">/rpc/*</code></a>
        path serialises the verb's args to a query, an
        <code class="font-mono">[id]</code>
        route takes its params then an optional query, and a bare path takes an optional query.
    </p>
    <div
        class="mt-3 flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-5">
        <label class="text-xs font-medium">
            id
            <input
                bind:value={productId}
                class="mt-1 block w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm">
        </label>
    </div>
    <div class="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">call</th>
                    <th class="px-4 py-2 font-medium">kind</th>
                    <th class="px-4 py-2 font-mono font-medium">result</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">{"url('/rpc/getProduct', { id })"}</td>
                    <td class="px-4 py-2 text-slate-600">rpc — args to query</td>
                    <td class="px-4 py-2 font-mono text-slate-900">{rpcHref}</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">{"url('/pages/product/[id]', { id })"}</td>
                    <td class="px-4 py-2 text-slate-600">page — params interpolated</td>
                    <td class="px-4 py-2 font-mono text-slate-900">{pageHref}</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">{"url('/robots.txt')"}</td>
                    <td class="px-4 py-2 text-slate-600">asset — bare path</td>
                    <td class="px-4 py-2 font-mono text-slate-900">{assetHref}</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">{"url('https://bun.sh', { utm })"}</td>
                    <td class="px-4 py-2 text-slate-600">external — passes through</td>
                    <td class="px-4 py-2 font-mono text-slate-900">{externalHref}</td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        A real link —
        <code class="font-mono">{"<a href={url('/pages/product/[id]', { id })}>"}</code>:
        <a class="underline" href={pageHref}>{pageHref}</a>. Mounted under a subpath via
        <code class="font-mono">APP_URL=https://app.com/v2</code>, every rooted result gains the
        <code class="font-mono">/v2</code>
        base (the shell's <code class="font-mono">/_app/</code> asset refs carry it too); the server
        still routes at root — pair it with a proxy that strips the prefix. The root layout's nav
        compares
        <code class="font-mono">page.url.pathname</code>
        against <code class="font-mono">url()</code> output for the same reason.
    </p>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="page + navigate + url — the three client primitives"
        code={`import { page } from '@belte/belte/browser/page'         // route, params, url, navigating
import { navigate } from '@belte/belte/browser/navigate'
import { url } from '@belte/belte/shared/url'

await navigate('/pages/product/1')                        // opts: { replace, scroll }

url('/rpc/getProduct', { id })          // /rpc/getProduct?id=2   — rpc args
url('/pages/product/[id]', { id })      // /pages/product/2       — page params
url('/robots.txt')                      // /robots.txt            — asset
url('https://bun.sh', { utm: 'belte' }) // untouched + ?utm=belte — external`} />

    <CodeBlock
        title="active-link idiom — compare page.url against url() output"
        lang="svelte"
        code={`<a
    href={url('/pages/product/[id]', { id: 7 })}
    class:active={page.url.pathname.startsWith(url('/pages'))}>`} />
</section>
