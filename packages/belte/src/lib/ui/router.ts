import { effect } from './effect.ts'
import { navigate } from './navigate.ts'
import { runtimePath } from './runtime/runtimePath.ts'
import type { Route } from './runtime/types/Route.ts'

/*
A minimal client router on the History API. `router` mounts the page matching the
current path into `host` and re-mounts on navigation (disposing the previous page
first). Same-origin `<a>` clicks are intercepted for SPA navigation and back/
forward drive it via `popstate`. There is no server router — the server picks the
page by request URL directly; this is the client half. `*` is the fallback route.
*/
// @readme plumbing
export function router(host: Element, routes: Record<string, Route>): () => void {
    let disposePage: (() => void) | undefined

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
        const page = routes[runtimePath.value] ?? routes['*']
        disposePage?.()
        if (first) {
            first = false
            if (page?.hydratable === true && page.hydrate !== undefined) {
                disposePage = page.hydrate(host)
                return
            }
        }
        host.innerHTML = ''
        disposePage = page === undefined ? undefined : (page(host) ?? undefined)
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
