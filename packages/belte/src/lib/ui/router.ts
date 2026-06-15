import { effect } from './effect.ts'
import { matchRoute } from './matchRoute.ts'
import { navigate } from './navigate.ts'
import { clientPage } from './runtime/clientPage.ts'
import { runtimePath } from './runtime/runtimePath.ts'
import type { Route } from './runtime/types/Route.ts'

/*
A minimal client router on the History API. `router` matches the current path
against the route patterns (literal / `[name]` / `[...rest]`, via matchRoute),
mounts the matching page with its decoded params, and re-mounts on navigation
(disposing the previous page first). It also publishes the active route/params/url
to `clientPage` so the `page` proxy resolves them reactively. Same-origin `<a>`
clicks are intercepted for SPA navigation and back/forward drive it via `popstate`.
There is no server router — the server picks the page by request URL directly;
this is the client half. `*` is the fallback route.
*/
// @readme plumbing
export function router(host: Element, routes: Record<string, Route>): () => void {
    let disposePage: (() => void) | undefined
    const patterns = Object.keys(routes).filter((key) => key !== '*')

    const onPopState = (): void => {
        runtimePath.value = location.pathname
    }
    const onClick = (event: Event): void => {
        const target = event.target as { closest?: (selector: string) => { href?: string } | null }
        const link = target.closest?.('a[href]')
        if (link?.href !== undefined && new URL(link.href).origin === location.origin) {
            event.preventDefault()
            navigate(new URL(link.href).pathname)
        }
    }
    if (typeof window !== 'undefined') {
        window.addEventListener('popstate', onPopState)
        document.addEventListener('click', onClick as EventListener)
    }

    /* First render adopts the server-rendered DOM (when the matching page is
       hydratable); navigation after that re-mounts fresh. */
    let first = true
    const stop = effect(() => {
        const path = runtimePath.value
        const matched = matchRoute(patterns, path)
        const view = matched !== undefined ? routes[matched.route] : routes['*']
        const params = matched?.params ?? {}
        /* Publish the active page so the `page` proxy resolves route/params/url. */
        clientPage.value = {
            route: matched?.route ?? path,
            params,
            url:
                typeof location === 'undefined'
                    ? new URL(`http://localhost${path}`)
                    : new URL(location.href),
            navigating: false,
        }
        disposePage?.()
        if (first) {
            first = false
            if (view?.hydratable === true && view.hydrate !== undefined) {
                disposePage = view.hydrate(host, params)
                return
            }
        }
        host.innerHTML = ''
        disposePage = view === undefined ? undefined : (view(host, params) ?? undefined)
    })

    return () => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('popstate', onPopState)
            document.removeEventListener('click', onClick as EventListener)
        }
        stop()
        disposePage?.()
    }
}
