import type { BunRequest } from 'bun'
import type { Pages } from '../../browser/types/Pages.ts'
import { toBunRoutePattern } from '../../shared/toBunRoutePattern.ts'
import type { RemoteRoutes } from '../rpc/types/RemoteRoutes.ts'
import type { createRouteDispatcher } from './createRouteDispatcher.ts'
import type { DispatchRequest } from './types/DispatchRequest.ts'

/*
Builds the Bun `routes` object: one entry per registered page/rpc URL, each
bound to its handler through dispatchRequest.

Page URLs (folder paths, e.g. `/media/[id]`) get translated to Bun's pattern
syntax (`/media/:id`) at registration. Bun's `*` wildcard matches but does not
capture into req.params, so for `[...rest]` routes the catch-all value is
reconstructed from the request URL by slicing the pathname segments after the
catch-all's pattern index. The reconstructed value is set under the original
name (e.g. `rest`) so the page component's $props destructure stays consistent
with the file path. Page URLs and rpc URLs (always `/rpc/...`, flat) are
disjoint by construction, so a plain object needs no deduplication.

A pure move out of createServer: buildRouteHandler and dispatchRequest are
injected so registration stays independent of how routes resolve and how the
request scope is wired.
*/
export function createRouteRegistry({
    pages,
    rpc,
    buildRouteHandler,
    dispatchRequest,
}: {
    pages: Pages
    rpc: RemoteRoutes
    buildRouteHandler: ReturnType<typeof createRouteDispatcher>
    dispatchRequest: DispatchRequest
}): Record<string, (req: BunRequest) => Promise<Response>> {
    const routes: Record<string, (req: BunRequest) => Promise<Response>> = {}
    for (const routeUrl of Object.keys(pages)) {
        const handler = buildRouteHandler(routeUrl)
        const { pattern, catchAllName } = toBunRoutePattern(routeUrl)
        const catchAllIndex = catchAllName
            ? routeUrl.split('/').findIndex((segment) => segment.startsWith('[...'))
            : -1
        /* Only catch-all routes copy req.params (to write the reconstructed
           segment); plain routes pass it through — it's never mutated downstream. */
        routes[pattern] =
            catchAllName && catchAllIndex !== -1
                ? (req) => {
                      const pathParams = {
                          ...((req.params as Record<string, string> | undefined) ?? {}),
                      }
                      const url = new URL(req.url)
                      pathParams[catchAllName] = url.pathname
                          .split('/')
                          .slice(catchAllIndex)
                          .join('/')
                      return dispatchRequest(req, pathParams, handler, url)
                  }
                : (req) =>
                      dispatchRequest(
                          req,
                          (req.params as Record<string, string> | undefined) ?? {},
                          handler,
                      )
    }
    for (const routeUrl of Object.keys(rpc)) {
        const handler = buildRouteHandler(routeUrl)
        routes[routeUrl] = (req) => dispatchRequest(req, {}, handler)
    }
    return routes
}
