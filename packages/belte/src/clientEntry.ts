// @ts-expect-error virtual module resolved by belteResolverPlugin
import { pages } from './_virtual/pages.ts'
import type { RouteLoader } from './lib/ui/runtime/types/RouteLoader.ts'
import { startClient } from './lib/ui/startClient.ts'

/*
The SSR client entry. The pages manifest is `{ route: () => import(page.belte) }`;
hand the loaders straight to belte-ui's startClient — the router imports each
route's chunk only when first visited, so the initial load downloads just the
current page's chunk (plus the entry), not every page up front. startClient also
seeds the cache from __SSR__, installs the base, and adopts the server-rendered
#app for the current route.
*/
startClient(pages as Record<string, RouteLoader>)
