import { beforeEach, describe, expect, test } from 'bun:test'
import { outbox } from '../src/lib/browser/outbox.ts'
import { createOutboxQueue } from '../src/lib/browser/rpcOutbox/createOutboxQueue.ts'
import { outboxRegistry } from '../src/lib/browser/rpcOutbox/outboxRegistry.ts'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { pending } from '../src/lib/shared/pending.ts'
import { prepareRpcModule } from '../src/lib/shared/prepareRpcModule.ts'
import type { PersistenceStore } from '../src/lib/shared/types/PersistenceStore.ts'
import { testSchema } from './standardSchema.ts'

function memoryStore(): PersistenceStore {
    const data: Record<string, unknown> = {}
    return {
        load: (key) => data[key],
        save: (key, snapshot) => {
            data[key] = snapshot
        },
        remove: (key) => {
            delete data[key]
        },
    }
}

const ok = () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
const post = (url: string, args: unknown) =>
    new Request(`http://app${url}`, {
        method: 'POST',
        body: JSON.stringify(args),
        headers: { 'content-type': 'application/json' },
    })

beforeEach(() => {
    outboxRegistry.reset()
})

describe('pending() counts parked durable writes', () => {
    test('a parked entry makes pending(rpc) true until it drains', async () => {
        const url = '/rpc/save-a'
        const saveA = defineRpc('POST', url, () => json({}), { inputSchema: testSchema() })
        const queue = createOutboxQueue({ url, store: memoryStore(), send: async () => ok() })
        outboxRegistry.register(url, queue, saveA)

        expect(pending(saveA)).toBe(false)
        queue.park({ a: 1 }, post(url, { a: 1 }))
        expect(pending(saveA)).toBe(true)
        await queue.retry()
        expect(pending(saveA)).toBe(false)
    })

    test('exact-args narrows the pending probe (offline double-submit guard)', () => {
        const url = '/rpc/save-b'
        const saveB = defineRpc('POST', url, () => json({}), { inputSchema: testSchema() })
        const queue = createOutboxQueue({ url, store: memoryStore(), send: async () => ok() })
        outboxRegistry.register(url, queue, saveB)

        queue.park({ a: 1 }, post(url, { a: 1 }))
        expect(pending(saveB, { a: 1 })).toBe(true)
        expect(pending(saveB, { a: 2 })).toBe(false)
    })
})

describe('global outbox()', () => {
    test('aggregates entries across rpcs tagged with their rpc, and retry drains all', async () => {
        const urlA = '/rpc/agg-a'
        const urlB = '/rpc/agg-b'
        const rpcA = defineRpc('POST', urlA, () => json({}), { inputSchema: testSchema() })
        const rpcB = defineRpc('POST', urlB, () => json({}), { inputSchema: testSchema() })
        const queueA = createOutboxQueue({
            url: urlA,
            store: memoryStore(),
            send: async () => ok(),
        })
        const queueB = createOutboxQueue({
            url: urlB,
            store: memoryStore(),
            send: async () => ok(),
        })
        outboxRegistry.register(urlA, queueA, rpcA)
        outboxRegistry.register(urlB, queueB, rpcB)

        queueA.park({ a: 1 }, post(urlA, { a: 1 }))
        queueB.park({ b: 2 }, post(urlB, { b: 2 }))

        const entries = outbox()
        expect(entries).toHaveLength(2)
        expect(entries.map((entry) => entry.rpc.url).sort()).toEqual([urlA, urlB])

        await outbox.retry()
        expect(outbox()).toHaveLength(0)
    })
})

describe('prepareRpcModule durable detection (build-time outbox flag)', () => {
    const moduleSource = (call: string) =>
        `import { POST } from 'belte/server/POST'\nexport const saveThing = ${call}`

    test('outbox: true marks the module durable', () => {
        const prepared = prepareRpcModule(
            moduleSource('POST(async (args) => args, { inputSchema, outbox: true })'),
            'belte',
        )
        expect(prepared?.durable).toBe(true)
    })

    test('outbox: false and no opts are not durable', () => {
        expect(
            prepareRpcModule(moduleSource('POST(async (args) => args, { outbox: false })'), 'belte')
                ?.durable,
        ).toBe(false)
        expect(prepareRpcModule(moduleSource('POST(async (args) => args)'), 'belte')?.durable).toBe(
            false,
        )
    })

    test('a computed outbox value is rejected at build time', () => {
        expect(() =>
            prepareRpcModule(moduleSource('POST(async (args) => args, { outbox: flag })'), 'belte'),
        ).toThrow('must be a literal')
    })

    test('outbox: true on a read method is rejected', () => {
        const source = `import { GET } from 'belte/server/GET'\nexport const readThing = GET(async (args) => args, { outbox: true })`
        expect(() => prepareRpcModule(source, 'belte')).toThrow('mutating RPCs')
    })

    test('an outbox mention inside the handler body does not misfire', () => {
        const prepared = prepareRpcModule(
            moduleSource('POST(async () => { const note = "outbox: true"; return note })'),
            'belte',
        )
        expect(prepared?.durable).toBe(false)
    })
})
