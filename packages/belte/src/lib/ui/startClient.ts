import { cacheEntryFromSnapshot } from '../shared/cacheEntryFromSnapshot.ts'
import { createCacheStore } from '../shared/createCacheStore.ts'
import { setBaseResolver } from '../shared/setBaseResolver.ts'
import { setCacheStoreResolver } from '../shared/setCacheStoreResolver.ts'
import { setGlobalCacheStoreResolver } from '../shared/setGlobalCacheStoreResolver.ts'
import { setPageResolver } from '../shared/setPageResolver.ts'
import type { CacheSnapshotEntry } from '../shared/types/CacheSnapshotEntry.ts'
import { router } from './router.ts'
import { clientPage } from './runtime/clientPage.ts'
import type { Route } from './runtime/types/Route.ts'

/* The server's __SSR__ payload this entry consumes. */
type SsrPayload = { cache?: CacheSnapshotEntry[]; base?: string }

/*
The official belte-ui client entry. Reads the server's `window.__SSR__` payload,
seeds a tab-scoped cache store from the inline snapshot (so a warm `cache()` read
resolves synchronously and the matching `<template await>` adopts the SSR DOM with
no re-fetch), installs the mount base, and starts the router — which adopts the
server-rendered `#app` for the initial route, then drives SPA navigation. Returns a
disposer. `target` defaults to `#app`; pass one explicitly in tests.
*/
// @readme plumbing
export function startClient(
    routes: Record<string, Route>,
    target: Element | null = typeof document !== 'undefined'
        ? document.getElementById('app')
        : null,
): () => void {
    if (target === null) {
        throw new Error('[belte] startClient: missing #app target')
    }
    const ssr = (globalThis as { __SSR__?: SsrPayload }).__SSR__ ?? {}
    setBaseResolver(() => ssr.base ?? '')
    /* The `page` proxy reads route/params/url off the router-updated snapshot. */
    setPageResolver(() => clientPage.value)

    const store = createCacheStore()
    setCacheStoreResolver(() => store)
    /* One tab store: cache(fn, { global: true }) shares it, so global is a no-op here. */
    setGlobalCacheStoreResolver(() => store)
    for (const entry of ssr.cache ?? []) {
        store.entries.set(entry.key, cacheEntryFromSnapshot(entry))
    }

    return router(target, routes)
}
