import { beforeEach, describe, expect, test } from 'bun:test'
import { createOutboxQueue } from '../src/lib/browser/rpcOutbox/createOutboxQueue.ts'
import { HttpError } from '../src/lib/shared/HttpError.ts'
import type { PersistenceStore } from '../src/lib/shared/types/PersistenceStore.ts'

/* An in-memory PersistenceStore exposing its data for assertions. */
function memoryStore(initial: Record<string, unknown> = {}): PersistenceStore & {
    data: Record<string, unknown>
} {
    const data: Record<string, unknown> = { ...initial }
    return {
        data,
        load: (key) => data[key],
        save: (key, snapshot) => {
            data[key] = snapshot
        },
        remove: (key) => {
            delete data[key]
        },
    }
}

const ok = (body: unknown) =>
    new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    })

const url = '/rpc/save'
const postRequest = (args: unknown) =>
    new Request(`http://app${url}`, {
        method: 'POST',
        body: JSON.stringify(args),
        headers: { 'content-type': 'application/json' },
    })

let store: ReturnType<typeof memoryStore>
beforeEach(() => {
    store = memoryStore()
})

describe('createOutboxQueue', () => {
    test('park records a queued entry; entries() and size() report it', () => {
        const queue = createOutboxQueue({ url, store, send: async () => ok({}) })
        const entry = queue.park({ a: 1 }, postRequest({ a: 1 }))
        expect(queue.size()).toBe(1)
        expect(entry.status).toBe('queued')
        expect(queue.entries()[0].args).toEqual({ a: 1 })
    })

    test('retry drains FIFO and removes delivered entries', async () => {
        const sent: unknown[] = []
        const queue = createOutboxQueue({
            url,
            store,
            send: async (request) => {
                sent.push(await request.clone().json())
                return ok({})
            },
        })
        queue.park({ n: 1 }, postRequest({ n: 1 }))
        queue.park({ n: 2 }, postRequest({ n: 2 }))
        await queue.retry()
        expect(sent).toEqual([{ n: 1 }, { n: 2 }])
        expect(queue.size()).toBe(0)
    })

    test('settled resolves with the decoded result on delivery', async () => {
        const queue = createOutboxQueue({ url, store, send: async () => ok({ id: '7' }) })
        const entry = queue.park({ a: 1 }, postRequest({ a: 1 }))
        const settled = entry.settled
        await queue.retry()
        expect(await settled).toEqual({ id: '7' })
    })

    test('an unreachable response keeps the entry queued and stops the drain', async () => {
        let attempt = 0
        const queue = createOutboxQueue({
            url,
            store,
            send: async () => {
                attempt += 1
                return attempt === 1 ? new Response('', { status: 503 }) : ok({})
            },
        })
        queue.park({ a: 1 }, postRequest({ a: 1 }))
        await queue.retry()
        expect(queue.size()).toBe(1)
        expect(queue.entries()[0].status).toBe('queued')
        await queue.retry()
        expect(queue.size()).toBe(0)
    })

    test('a server rejection (4xx) removes the entry and rejects settled', async () => {
        const queue = createOutboxQueue({
            url,
            store,
            send: async () => new Response('nope', { status: 400 }),
        })
        const entry = queue.park({ a: 1 }, postRequest({ a: 1 }))
        const settled = entry.settled
        await queue.retry()
        expect(queue.size()).toBe(0)
        await expect(settled).rejects.toBeInstanceOf(HttpError)
    })

    test('aborting a queued entry removes it before any send', () => {
        const queue = createOutboxQueue({ url, store, send: async () => ok({}) })
        const entry = queue.park({ a: 1 }, postRequest({ a: 1 }))
        entry.controller.abort()
        expect(queue.size()).toBe(0)
    })

    test('persisted entries restore on a fresh queue with a live request and fresh controller', () => {
        const seeded = memoryStore({
            [`belte:outbox:${url}`]: [
                {
                    id: 'x1',
                    args: { a: 1 },
                    method: 'POST',
                    url: `http://app${url}`,
                    body: '{"a":1}',
                    contentType: 'application/json',
                    status: 'queued',
                },
            ],
        })
        const queue = createOutboxQueue({ url, store: seeded, send: async () => ok({}) })
        expect(queue.size()).toBe(1)
        const entry = queue.entries()[0]
        expect(entry.args).toEqual({ a: 1 })
        expect(entry.request.method).toBe('POST')
        expect(entry.controller.signal.aborted).toBe(false)
    })

    test('persists the queue across mutations so a reload sees the backlog', () => {
        const queue = createOutboxQueue({ url, store, send: async () => ok({}) })
        queue.park({ a: 1 }, postRequest({ a: 1 }))
        const persisted = store.data[`belte:outbox:${url}`] as unknown[]
        expect(persisted).toHaveLength(1)
    })
})
