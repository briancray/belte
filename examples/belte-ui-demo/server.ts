import { resolve } from 'node:path'
import type { BunPlugin } from 'bun'
import { belteUiPlugin } from '../../packages/belte/src/lib/ui/compile/belteUiPlugin.ts'
import { compileSSR } from '../../packages/belte/src/lib/ui/compile/compileSSR.ts'
import { derived } from '../../packages/belte/src/lib/ui/derived.ts'
import { doc } from '../../packages/belte/src/lib/ui/doc.ts'
import { effect } from '../../packages/belte/src/lib/ui/effect.ts'
import type { SsrRender } from '../../packages/belte/src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../../packages/belte/src/lib/ui/state.ts'

/*
A real multi-page belte-ui app, end to end through the actual pipeline:

  - the CLIENT bundle is built by `Bun.build` + `belteUiPlugin` (the real `.belte`
    loader) — one bundle with both pages + the router — with a resolver mapping the
    emitted `belte/ui/*` imports to source;
  - each route is SERVER-rendered via `compileSSR` and served by `Bun.serve`; the
    client router then takes over for in-place navigation.

In a published app these would be `belte build` / `belte start`; here the example
sits beside the in-development framework, so it wires the pieces directly.
*/

const UI_SRC = resolve(import.meta.dir, '../../packages/belte/src/lib/ui')
const PAGES: Record<string, string> = { '/': 'Home.belte', '/about': 'About.belte' }

/* Maps the `belte/ui/*` specifiers compiled components emit to the framework
   source (in a published package these resolve through `@belte/belte`'s exports). */
const belteUiResolver: BunPlugin = {
    name: 'belte-ui-resolve',
    setup(build) {
        build.onResolve({ filter: /^belte\/ui\// }, (args) => ({
            path: `${resolve(UI_SRC, args.path.replace(/^belte\/ui\//, ''))}.ts`,
        }))
    },
}

/* Builds the one browser bundle (both pages + router) for the client. */
export async function buildClient(): Promise<string> {
    const built = await Bun.build({
        entrypoints: [resolve(import.meta.dir, 'main.ts')],
        plugins: [belteUiPlugin, belteUiResolver],
        target: 'browser',
    })
    if (!built.success) {
        throw new AggregateError(built.logs, 'belte-ui demo: client build failed')
    }
    return built.outputs[0].text()
}

/* Server-renders the page for `path` via the SSR back-end. */
export async function renderShell(path = '/'): Promise<string> {
    const source = await Bun.file(resolve(import.meta.dir, PAGES[path] ?? PAGES['/'])).text()
    const render = new Function('doc', 'state', 'derived', 'effect', compileSSR(source)) as (
        ...runtime: unknown[]
    ) => SsrRender
    return render(doc, state, derived, effect).html
}

function page(shell: string, clientJs: string): string {
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>belte-ui demo</title></head>
<body><div id="app">${shell}</div><script type="module">${clientJs}</script></body>
</html>`
}

/* Starts the HTTP server: one client bundle, SSR per route. */
export async function serve(port = 3737) {
    const clientJs = await buildClient()
    return Bun.serve({
        port,
        async fetch(request) {
            const path = new URL(request.url).pathname
            if (!(path in PAGES)) {
                return new Response('not found', { status: 404 })
            }
            return new Response(page(await renderShell(path), clientJs), {
                headers: { 'content-type': 'text/html; charset=utf-8' },
            })
        },
    })
}

if (import.meta.main) {
    const server = await serve()
    console.log(`belte-ui demo running at ${server.url}`)
}
