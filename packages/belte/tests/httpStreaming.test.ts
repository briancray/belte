import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Pages } from '../src/lib/browser/types/Pages.ts'
import type { RemoteRoutes } from '../src/lib/server/rpc/types/RemoteRoutes.ts'
import { RESOLVE_STREAM_PATH } from '../src/lib/shared/RESOLVE_STREAM_PATH.ts'
import { bootTestServer } from './support/bootTestServer.ts'
import { slowData } from './support/fixtures/rpc/slowData.ts'
import { slowGate } from './support/fixtures/rpc/slowGate.ts'

/*
End-to-end characterization of the SSR streaming handshake over real HTTP:
a {#await} cache read leaves the entry pending, the document ships its
placeholder key + a single-use stream token, and the out-of-band resolve
channel drains the SAME stashed promise — the handler never runs twice. The
gate fixture controls when the read settles, so nothing here sleeps.
*/

const pages: Pages = {
    '/streaming': () => import('./support/fixtures/pages/streaming.svelte'),
}

const rpc: RemoteRoutes = {
    '/rpc/http-slow': async () => ({ slowData }),
}

function ssrState(html: string): Record<string, unknown> | undefined {
    const match = html.match(/window\.__SSR__ = (.+?);<\/script>/)
    return match ? JSON.parse(match[1]) : undefined
}

describe('SSR streaming over HTTP', () => {
    let origin: string
    let stop: () => void

    beforeAll(async () => {
        const booted = await bootTestServer({ pages, rpc })
        origin = booted.origin
        stop = booted.stop
    })
    afterAll(() => {
        stop()
    })

    test('a pending {#await} read streams: placeholder in the doc, value over the channel', async () => {
        slowGate.reset()

        /* Document returns immediately with the pending branch — render never blocks on the gate. */
        const html = await fetch(`${origin}/streaming`).then((res) => res.text())
        expect(html).toContain('data-pending')
        expect(slowGate.calls).toBe(1)

        const state = ssrState(html)
        const streaming = state?.streaming as Array<{ key: string; url: string; method: string }>
        expect(streaming).toHaveLength(1)
        // Placeholder URLs are absolute — the synthesized Request's full href.
        expect(new URL(streaming[0].url).pathname).toBe('/rpc/http-slow')
        expect(streaming[0].method).toBe('GET')
        const token = state?.streamToken as string
        expect(typeof token).toBe('string')

        /* Open the resolve channel, then release the gate so the stashed promise settles. */
        const streamResponse = fetch(`${origin}${RESOLVE_STREAM_PATH}${token}`)
        slowGate.current.release()
        const res = await streamResponse
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('application/x-ndjson')

        const lines = (await res.text()).trim().split('\n')
        expect(lines).toHaveLength(1)
        const resolution = JSON.parse(lines[0])
        expect(resolution.key).toBe(streaming[0].key)
        expect(resolution.status).toBe(200)
        expect(JSON.parse(resolution.body)).toEqual({ n: 1 })

        /* Drained the stashed SSR promise — the handler did not run a second time. */
        expect(slowGate.calls).toBe(1)

        /* The token is single-use: a replay is told to re-fetch live. */
        const replay = await fetch(`${origin}${RESOLVE_STREAM_PATH}${token}`)
        expect(replay.status).toBe(404)
    })

    test('an unknown stream token is 404', async () => {
        const res = await fetch(`${origin}${RESOLVE_STREAM_PATH}not-a-token`)
        expect(res.status).toBe(404)
    })
})
