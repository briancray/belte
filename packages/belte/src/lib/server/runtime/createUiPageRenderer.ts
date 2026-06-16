import { appNameSlot } from '../../shared/appNameSlot.ts'
import { SSR_CACHE_CONTROL } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { formatTraceparent } from '../../shared/formatTraceparent.ts'
import { renderToStream } from '../../ui/renderToStream.ts'
import type { UiComponent } from '../../ui/runtime/types/UiComponent.ts'
import { pageUrlFromStore } from './pageUrlFromStore.ts'
import { SSR_SWAP_SCRIPT } from './SSR_SWAP_SCRIPT.ts'
import { safeJsonForScript } from './safeJsonForScript.ts'
import { serializeCacheSnapshot } from './serializeCacheSnapshot.ts'
import type { RequestStore } from './types/RequestStore.ts'

/* A belte-ui page module: its default export is the compiled component. */
type LoadPage = () => Promise<{ default: UiComponent }>

const SSR_MARKER = /<!--ssr:(head|body|state)-->/g
const BODY_MARKER = '<!--ssr:body-->'

function wantsJson(request: Request): boolean {
    return (request.headers.get('accept') ?? '').includes('application/json')
}

/*
The belte-ui SSR document renderer — the svelte-free counterpart to
createPageRenderer. A matched route + params in, a finished HTML Response out.

A page with no `await` block renders synchronously and ships buffered. A page with
await blocks STREAMS: the pending shell flushes first, then each resolved fragment
(`<belte-resolve data-resume>`) as its promise settles, swapped into its boundary
by the inline SSR_SWAP_SCRIPT — which also registers the value into the resume
manifest so client hydration adopts it without re-fetching (see belte/ui/awaitBlock).

`__SSR__` carries the route/params, mount base, trace, app name, client timeout,
and the settled cache snapshot (the client seeds its tab store from it). Layouts
are userland in belte-ui (a page imports and wraps its own), so there is no
framework layout/error resolution here.
*/
export function createUiPageRenderer({
    shell,
    base,
    clientTimeout,
    pages,
    healthPayload,
}: {
    shell: string
    base: string
    clientTimeout: number | undefined
    pages: Record<string, LoadPage>
    healthPayload: (request: Request) => Promise<Record<string, unknown>>
}): {
    renderPage: (
        routeUrl: string,
        params: Record<string, string>,
        store: RequestStore,
    ) => Promise<Response>
    renderError: (
        status: number,
        message: string,
        store: RequestStore,
        stack?: string,
    ) => Promise<Response | undefined>
} {
    /* Build the __SSR__ <script> the client (startClient) reads on boot. */
    async function stateTag(
        routeUrl: string,
        params: Record<string, string>,
        store: RequestStore,
    ): Promise<string> {
        const { inline } = await serializeCacheSnapshot(store.cache)
        const health = store.healthRead ? await healthPayload(store.req) : undefined
        const payload = safeJsonForScript({
            route: routeUrl,
            params,
            cache: inline,
            base: base || undefined,
            trace: formatTraceparent(store.trace),
            app: appNameSlot.name,
            health,
            clientTimeout,
        })
        return `<script>window.__SSR__ = ${payload};</script>`
    }

    async function renderPage(
        routeUrl: string,
        params: Record<string, string>,
        store: RequestStore,
    ): Promise<Response> {
        store.route = routeUrl
        store.params = params
        /* Touch pageUrl so the page proxy resolves the browser-space URL during SSR. */
        pageUrlFromStore(store)
        if (wantsJson(store.req)) {
            return Response.json(
                { route: routeUrl, params },
                { headers: { Vary: 'Accept', 'Cache-Control': SSR_CACHE_CONTROL } },
            )
        }
        const loadPage = pages[routeUrl]
        if (loadPage === undefined) {
            throw new Error(`[belte] unknown route: ${routeUrl}`)
        }
        const { default: Page } = await loadPage()
        const ssr = Page.render(params)

        /* No await blocks → render synchronously, ship buffered. */
        if (ssr.awaits.length === 0) {
            const html = shell.replace(SSR_MARKER, (_match, key: string) =>
                key === 'body' ? ssr.html : key === 'state' ? '' : '',
            )
            const withState = html.replace(
                '</body>',
                `${await stateTag(routeUrl, params, store)}</body>`,
            )
            return new Response(withState, {
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    Vary: 'Accept',
                    'Cache-Control': SSR_CACHE_CONTROL,
                },
            })
        }

        /* Await blocks → stream the shell, then resolved fragments as they settle.
           Fill head/state but LEAVE the body marker intact — it's the split point for
           streaming the page body into `#app`; consuming it here would append the body
           after the whole shell (outside `#app`), breaking hydration. */
        const head = `<script>${SSR_SWAP_SCRIPT}</script>${await stateTag(routeUrl, params, store)}`
        const filled = shell.replace(/<!--ssr:(head|state)-->/g, (_match, key: string) =>
            key === 'head' ? head : '',
        )
        const [before, after] = filled.split(BODY_MARKER)
        const encoder = new TextEncoder()
        return new Response(
            new ReadableStream({
                async start(controller) {
                    controller.enqueue(encoder.encode(before ?? ''))
                    let first = true
                    for await (const chunk of renderToStream(() => ssr)) {
                        controller.enqueue(
                            encoder.encode(
                                first ? chunk : `${chunk}<script>__belteSwap()</script>`,
                            ),
                        )
                        first = false
                    }
                    controller.enqueue(encoder.encode(after ?? ''))
                    controller.close()
                },
            }),
            {
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': SSR_CACHE_CONTROL,
                },
            },
        )
    }

    /* Layouts/errors are userland in belte-ui — no framework error view to render,
       so the caller falls back to its plain Response (404 text) or rethrows. */
    async function renderError(): Promise<Response | undefined> {
        return undefined
    }

    return { renderPage, renderError }
}
