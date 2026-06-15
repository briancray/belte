// @ts-expect-error virtual module resolved by belteResolverPlugin
import { pages } from './_virtual/pages.ts'
import type { Route } from './lib/ui/runtime/types/Route.ts'
import { startClient } from './lib/ui/startClient.ts'

/*
The SSR client entry. The pages manifest is `{ route: () => import(page.belte) }`;
resolve each to its component once at boot so the router gets a plain route map
(the dynamic imports still code-split, they just all load up front), then hand off
to belte-ui's startClient — which seeds the cache from __SSR__, installs the base,
and adopts the server-rendered #app for the current route.
*/
const loaders = pages as Record<string, () => Promise<{ default: Route }>>
const routes = Object.fromEntries(
    await Promise.all(
        Object.entries(loaders).map(async ([route, load]) => [route, (await load()).default]),
    ),
) as Record<string, Route>

startClient(routes)
