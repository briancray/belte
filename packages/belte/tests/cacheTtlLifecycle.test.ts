import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { serializeCacheSnapshot } from '../src/lib/server/runtime/serializeCacheSnapshot.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { globalCacheStoreSlot } from '../src/lib/shared/globalCacheStoreSlot.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'

const options = { logRequests: false }

/*
Characterizes the entry eviction lifecycle through the public surface — the
edges the other cache suites don't pin:

  - ttl=0 remote entries on the SERVER stay in the request-scoped store after
    settling so the post-render SSR snapshot can still inline them; on the
    CLIENT (window defined) and in the process-level global store they evict
    the moment they settle.
  - ttl>0 entries evict after expiry; a read inside the window shares the
    entry without re-running the handler.
  - a rejected call evicts its entry, so the next read retries instead of
    caching the failure.
*/

let calls = 0
const countedRemote = defineVerb('GET', '/rpc/ttl-counted', () => json({ hit: ++calls }))

let failures = 0
const flakyRemote = defineVerb('GET', '/rpc/ttl-flaky', () => {
    failures += 1
    if (failures === 1) {
        throw new Error('first call fails')
    }
    return json({ hit: failures })
})

beforeAll(() => {
    cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
})
afterAll(() => {
    cacheStoreSlot.resolver = undefined
    globalCacheStoreSlot.resolver = undefined
})

async function inServerScope<T>(body: (store: CacheStore) => Promise<T>): Promise<T> {
    let result!: T
    await runWithRequestScope(new Request('https://test.local/'), options, async (store) => {
        result = await body(store.cache)
        return new Response('ok')
    })
    return result
}

describe('ttl=0 (dedupe only)', () => {
    test('server keeps the settled remote entry for the SSR snapshot', async () => {
        await inServerScope(async (store) => {
            await cache(countedRemote, { ttl: 0 })()
            /* Settled, but retained: the snapshot runs after render() returns. */
            expect(store.entries.size).toBe(1)
            const { inline } = await serializeCacheSnapshot(store)
            expect(inline).toHaveLength(1)
        })
    })

    test('client evicts the settled remote entry (window defined)', async () => {
        const globalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
        ;(globalThis as Record<string, unknown>).window = {}
        try {
            await inServerScope(async (store) => {
                await cache(countedRemote, { ttl: 0 })()
                /* Settle handler ran in the await above; client path evicts immediately. */
                expect(store.entries.size).toBe(0)
            })
        } finally {
            if (globalDescriptor) {
                Object.defineProperty(globalThis, 'window', globalDescriptor)
            } else {
                delete (globalThis as Record<string, unknown>).window
            }
        }
    })

    test('the process-level global store evicts on settle (would leak forever)', async () => {
        const globalStore = createCacheStore()
        globalCacheStoreSlot.resolver = () => globalStore
        try {
            await inServerScope(async () => {
                await cache(countedRemote, { ttl: 0, global: true })()
            })
            expect(globalStore.entries.size).toBe(0)
        } finally {
            globalCacheStoreSlot.resolver = undefined
        }
    })
})

describe('ttl>0 (expire after resolve)', () => {
    test('a read inside the window shares the entry; expiry evicts it', async () => {
        calls = 0
        const globalStore = createCacheStore()
        globalCacheStoreSlot.resolver = () => globalStore
        try {
            /* Global store so the entry outlives the request scope, like a real memo. */
            await inServerScope(async () => {
                await cache(countedRemote, { ttl: 20, global: true })()
            })
            await inServerScope(async () => {
                expect(await cache(countedRemote, { ttl: 20, global: true })()).toEqual({
                    hit: 1,
                })
            })
            expect(calls).toBe(1)

            /* Past expiry the entry is evicted and the next read re-runs the handler. */
            await Bun.sleep(35)
            expect(globalStore.entries.size).toBe(0)
            await inServerScope(async () => {
                expect(await cache(countedRemote, { ttl: 20, global: true })()).toEqual({
                    hit: 2,
                })
            })
        } finally {
            globalCacheStoreSlot.resolver = undefined
        }
    })
})

describe('rejection', () => {
    test('a rejected call evicts its entry so the next read retries', async () => {
        failures = 0
        await inServerScope(async (store) => {
            await expect(cache(flakyRemote)()).rejects.toThrow()
            /* Give the rejection's eviction handler a microtask to run. */
            await Bun.sleep(1)
            expect(store.entries.size).toBe(0)
            /* Same scope, same key: the failure was not cached. */
            expect(await cache(flakyRemote)()).toEqual({ hit: 2 })
        })
    })
})
