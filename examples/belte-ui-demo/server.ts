import { resolve } from 'node:path'
import type { BunPlugin } from 'bun'
import { belteUiPlugin } from '../../packages/belte/src/lib/ui/compile/belteUiPlugin.ts'
import { compileSSR } from '../../packages/belte/src/lib/ui/compile/compileSSR.ts'
import { derived } from '../../packages/belte/src/lib/ui/derived.ts'
import { doc } from '../../packages/belte/src/lib/ui/doc.ts'
import { effect } from '../../packages/belte/src/lib/ui/effect.ts'
import { state } from '../../packages/belte/src/lib/ui/state.ts'
import type { SsrRender } from '../../packages/belte/src/lib/ui/runtime/types/SsrRender.ts'

/*
A real running belte-ui app, end to end through the actual pipeline:

  - the CLIENT bundle is built by `Bun.build` + `belteUiPlugin` (the real `.belte`
    loader), with a resolver that maps the emitted `belte/ui/*` imports to source;
  - the page is SERVER-rendered via `compileSSR` and served over HTTP by `Bun.serve`.

In a published app these would be `belte build` / `belte start`; here the example
lives beside the in-development framework, so it wires the pieces directly. The
SSR HTML paints first; the client bundle then mounts for interactivity.
*/

const UI_SRC = resolve(import.meta.dir, '../../packages/belte/src/lib/ui')

/* Maps the `belte/ui/*` specifiers the compiled component emits to the framework
   source (in a published package these resolve through `@belte/belte`'s exports). */
const belteUiResolver: BunPlugin = {
    name: 'belte-ui-resolve',
    setup(build) {
        build.onResolve({ filter: /^belte\/ui\// }, (args) => ({
            path: `${resolve(UI_SRC, args.path.replace(/^belte\/ui\//, ''))}.ts`,
        }))
    },
}

/* Builds the browser bundle for the page's client entry. */
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

/* Server-renders the component to HTML via the SSR back-end. */
export async function renderShell(): Promise<string> {
    const source = await Bun.file(resolve(import.meta.dir, 'Counter.belte')).text()
    const render = new Function('doc', 'state', 'derived', 'effect', compileSSR(source)) as (
        ...runtime: unknown[]
    ) => SsrRender
    return render(doc, state, derived, effect).html
}

/* Assembles the full HTML document: SSR shell + inlined client bundle. */
function page(shell: string, clientJs: string): string {
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>belte-ui demo</title></head>
<body><div id="app">${shell}</div><script type="module">${clientJs}</script></body>
</html>`
}

/* Starts the HTTP server. `port: 0` picks a free port (used by the verifier). */
export async function serve(port = 3737) {
    const [clientJs, shell] = await Promise.all([buildClient(), renderShell()])
    const html = page(shell, clientJs)
    return Bun.serve({
        port,
        fetch(request) {
            return new URL(request.url).pathname === '/'
                ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
                : new Response('not found', { status: 404 })
        },
    })
}

if (import.meta.main) {
    const server = await serve()
    console.log(`belte-ui demo running at ${server.url}`)
}
