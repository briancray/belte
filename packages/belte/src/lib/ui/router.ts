import { effect } from './effect.ts'
import { matchRoute } from './matchRoute.ts'
import { navigate } from './navigate.ts'
import { clientPage } from './runtime/clientPage.ts'
import { runtimePath } from './runtime/runtimePath.ts'
import type { NavVerdict } from './runtime/types/NavVerdict.ts'
import type { Route } from './runtime/types/Route.ts'
import type { RouteLoader } from './runtime/types/RouteLoader.ts'
import { untrack } from './runtime/untrack.ts'

/*
A minimal client router on the History API. `router` matches the current path
against the route patterns (literal / `[name]` / `[...rest]`, via matchRoute),
imports the matching page's chunk on demand, mounts it with its decoded params,
and re-mounts on navigation (disposing the previous page first). Each page's chunk
loads only when its route is first visited — a code-split loader per route, cached
after first resolution — so navigation never downloads pages it hasn't reached.
It also publishes the active route/params/url to `clientPage` so the `page` proxy
resolves them reactively. Same-origin `<a>` clicks are intercepted for SPA
navigation and back/forward drive it via `popstate`.

`probe` (when given) runs each post-boot navigation's destination through the
server's app.handle first, so auth/redirect gating applies to client navigation
just as it does to a fresh load; its verdict either clears the mount, soft-redirects
where handle() pointed, or hands off to a full browser load. The first render
adopts a document handle() already ran on, so it isn't probed. There is no server
router — the server picks the page by request URL directly; this is the client
half. `*` is the fallback route.
*/
// @readme plumbing
export function router(
    host: Element,
    loaders: Record<string, RouteLoader>,
    probe?: (path: string) => Promise<NavVerdict>,
): () => void {
    let disposePage: (() => void) | undefined
    const patterns = Object.keys(loaders).filter((key) => key !== '*')

    /* Resolved chunks, keyed by route pattern, so a revisit re-mounts without a
       second import. */
    const resolved = new Map<string, Route | undefined>()
    const resolve = async (key: string): Promise<Route | undefined> => {
        if (resolved.has(key)) {
            return resolved.get(key)
        }
        const loader = loaders[key]
        const view = loader === undefined ? undefined : (await loader()).default
        resolved.set(key, view)
        return view
    }

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
    /* Monotonic token: a newer navigation that resolves first wins, so a slow
       chunk landing late never overwrites the page the user has since moved to. */
    let sequence = 0
    const stop = effect(() => {
        /* The route is the only dependency the router should re-run on. Everything
           else runs untracked so the page's build-time reads (each interpolation
           reads its value once before wrapping it in its own effect) bind to the
           page's own effects, not this one — otherwise any in-page state change
           would re-run the router and re-mount the page, dropping local state. */
        const path = runtimePath.value
        untrack(() => {
            const matched = matchRoute(patterns, path)
            const key = matched?.route ?? '*'
            const params = matched?.params ?? {}
            const token = (sequence += 1)
            /* First paint adopts a document the server already ran handle() on;
               only later navigations re-run it through the probe. */
            const verdict: Promise<NavVerdict> =
                first || probe === undefined ? Promise.resolve({ kind: 'mount' }) : probe(path)
            /* Resolve the chunk and gate the navigation in parallel, keeping the
               current page mounted until both land — no blank frame while the
               import is in flight or the probe is in the air. */
            void Promise.all([resolve(key), verdict]).then(([view, decision]) => {
                if (token !== sequence) {
                    return
                }
                /* handle() redirected: go where it pointed, replacing the blocked
                   URL so back doesn't trap on it. The router re-probes the target. */
                if (decision.kind === 'redirect') {
                    navigate(decision.path, true)
                    return
                }
                /* handle() blocked it / redirected off-origin / the probe failed:
                   let the browser load the server's real response. */
                if (decision.kind === 'reload') {
                    if (typeof location !== 'undefined') {
                        location.href = decision.url
                    }
                    return
                }
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
        })
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
