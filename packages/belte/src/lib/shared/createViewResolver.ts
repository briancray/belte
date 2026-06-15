import type { Errors } from '../browser/types/Errors.ts'
import type { Layouts } from '../browser/types/Layouts.ts'
import type { Pages } from '../browser/types/Pages.ts'
import { belteLog } from './belteLog.ts'
import { nearestLayoutPrefix, normalizeLayoutPrefixes } from './nearestLayoutPrefix.ts'
import type { ResolvedView } from './types/ResolvedView.ts'
import type { ViewResolver } from './types/ViewResolver.ts'

/* View-resolution spans, opt-in via DEBUG=belte:view: a `resolve` parent over
   the selection logic, with the page/layout `import` (the cold-load cost) as
   its own child so a slow first hit reads as the module load it is. */
const viewLog = belteLog.channel('belte:view')

/*
Isomorphic view resolution: a matched route in, mountable components out.
Owns the layout/error questions end to end — prefix normalization at
construction, nearest-ancestor selection (deepest prefix that is an ancestor
of the route, no stacking) and the parallel page+layout module load per call
— so the server renderer and the client navigator resolve a view through the
same rules without knowing them. `error` resolves the nearest error.svelte
for a failed pathname inside that pathname's nearest layout, undefined when
no error boundary covers it.
*/
export function createViewResolver({
    pages,
    layouts,
    errors,
}: {
    pages: Pages
    layouts?: Layouts
    errors?: Errors
}): ViewResolver {
    const layoutPrefixes = normalizeLayoutPrefixes(Object.keys(layouts ?? {}))
    const errorPrefixes = normalizeLayoutPrefixes(Object.keys(errors ?? {}))

    /* Loads a view module and its nearest layout concurrently, unwrapping defaults. */
    async function loadWithLayout(
        route: string,
        loadViewModule: () => Promise<{ default: ResolvedView['Page'] }>,
    ): Promise<ResolvedView> {
        const layoutPrefix = nearestLayoutPrefix(route, layoutPrefixes)
        /* bind the loader first so the index access stays defined under a
           consumer's noUncheckedIndexedAccess */
        const loadLayout = layoutPrefix && layouts ? layouts[layoutPrefix] : undefined
        /* The import() is the cold-load cost (transpile + evaluate the module
           graph on first hit); span it apart from the cheap selection logic. */
        const [viewModule, layoutModule] = await Promise.all([
            viewLog.trace(`import ${route}`, loadViewModule),
            loadLayout
                ? viewLog.trace(`import layout ${layoutPrefix}`, loadLayout)
                : Promise.resolve(undefined),
        ])
        return { Page: viewModule.default, Layout: layoutModule?.default }
    }

    return {
        has: (route) => Boolean(pages[route]),

        /* async so an unknown route rejects rather than throwing sync — one error mode for callers. */
        view: async (route) => {
            const loadPage = pages[route]
            if (!loadPage) {
                throw new Error(`[belte] unknown route: ${route}`)
            }
            return viewLog.trace(`resolve ${route}`, () => loadWithLayout(route, loadPage))
        },

        error: async (pathname) => {
            const errorPrefix = nearestLayoutPrefix(pathname, errorPrefixes)
            const loadError = errorPrefix && errors ? errors[errorPrefix] : undefined
            if (!loadError) {
                return undefined
            }
            return viewLog.trace(`resolve-error ${pathname}`, () =>
                loadWithLayout(pathname, loadError),
            )
        },

        prefixes: (route) => ({
            layout: nearestLayoutPrefix(route, layoutPrefixes),
            error: nearestLayoutPrefix(route, errorPrefixes),
        }),
    }
}
