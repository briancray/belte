/* Per-call RpcOptions on the client proxy: the optional 2nd arg threads transport options
   onto the fetch — `signal` (composed with the client timeout), `keepalive`/`priority`/`cache`
   passed through, and `headers` merged onto the framework headers (framework wins). The
   server never observes them, so the callable stays isomorphic. */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { remoteProxy } from '../src/lib/browser/remoteProxy.ts'
import { OFFLINE_HEADER } from '../src/lib/shared/OFFLINE_HEADER.ts'

const originalFetch = globalThis.fetch
const originalWindow = (globalThis as { window?: unknown }).window

let lastRequest: Request | undefined
let lastInit: RequestInit | undefined

beforeEach(() => {
    lastRequest = undefined
    lastInit = undefined
    ;(globalThis as { window?: unknown }).window = { location: { href: 'https://test.local/' } }
    globalThis.fetch = ((request: Request, init?: RequestInit) => {
        lastRequest = request
        lastInit = init
        return Promise.resolve(new Response('ok', { status: 200 }))
    }) as typeof fetch
})

afterEach(() => {
    globalThis.fetch = originalFetch
    ;(globalThis as { window?: unknown }).window = originalWindow
})

test('opts.signal / keepalive / priority / cache reach the fetch init', async () => {
    const ping = remoteProxy<{ id: string }, string>('GET', '/rpc/ping')
    const controller = new AbortController()
    await ping.raw({ id: '1' }, { signal: controller.signal, keepalive: true, priority: 'high' })
    expect(lastInit?.signal).toBe(controller.signal)
    expect(lastInit?.keepalive).toBe(true)
    expect(lastInit?.priority).toBe('high')
})

test('a call with no opts takes the unbounded fetch path (no init allocated)', async () => {
    const ping = remoteProxy<{ id: string }, string>('GET', '/rpc/ping')
    await ping.raw({ id: '1' })
    expect(lastInit).toBeUndefined()
})

test('opts.headers merge onto the request the proxy builds', async () => {
    const ping = remoteProxy<{ id: string }, string>('GET', '/rpc/ping')
    await ping.raw({ id: '1' }, { headers: { 'idempotency-key': 'abc' } })
    expect(lastRequest?.headers.get('idempotency-key')).toBe('abc')
})

test('opts pass through the decoding call (fn(args, opts)) too, not just .raw', async () => {
    const ping = remoteProxy<{ id: string }, string>('GET', '/rpc/ping')
    const controller = new AbortController()
    await ping({ id: '1' }, { signal: controller.signal })
    expect(lastInit?.signal).toBe(controller.signal)
})

/* A caller can add transport headers but can't overwrite the framework's: rpcHeaders sets
   the offline marker last, so a caller value for it loses. */
test('framework headers win over caller headers of the same name', async () => {
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator
    ;(globalThis as { navigator?: unknown }).navigator = { onLine: false }
    try {
        const ping = remoteProxy<{ id: string }, string>('GET', '/rpc/ping')
        await ping.raw({ id: '1' }, { headers: { [OFFLINE_HEADER]: 'caller-tried' } })
        expect(lastRequest?.headers.get(OFFLINE_HEADER)).toBe('1')
    } finally {
        ;(globalThis as { navigator?: unknown }).navigator = originalNavigator
    }
})
