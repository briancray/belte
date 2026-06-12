import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Errors } from '../src/lib/browser/types/Errors.ts'
import type { Layouts } from '../src/lib/browser/types/Layouts.ts'
import type { Pages } from '../src/lib/browser/types/Pages.ts'
import { json } from '../src/lib/server/json.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import type { RemoteRoutes } from '../src/lib/server/rpc/types/RemoteRoutes.ts'
import { bootTestServer } from './support/bootTestServer.ts'
import { fastData } from './support/fixtures/rpc/fastData.ts'

/*
HTTP-level characterization of createServer: a real Bun.serve on an ephemeral
port, fixture pages/layouts/errors compiled SSR-side by the preload, asserted
through fetch. These pin the externally observable contract — routing, SSR
document shape, `__SSR__` state, error rendering, verb dispatch — so the
internals (route resolution, request scope, cache serialization) can be
restructured against a stable surface.
*/

const echo = defineVerb('GET', '/rpc/http-echo', () => json({ echoed: true }))

const pages: Pages = {
    '/': () => import('./support/fixtures/pages/home.svelte'),
    '/post/[id]': () => import('./support/fixtures/pages/post.svelte'),
    '/docs/[...rest]': () => import('./support/fixtures/pages/docs.svelte'),
    '/admin': () => import('./support/fixtures/pages/admin.svelte'),
    '/boom': () => import('./support/fixtures/pages/boom.svelte'),
    '/settled': () => import('./support/fixtures/pages/settled.svelte'),
}

const layouts: Layouts = {
    '/': () => import('./support/fixtures/layouts/root.svelte'),
    '/admin': () => import('./support/fixtures/layouts/admin.svelte'),
}

const errors: Errors = {
    '/': () => import('./support/fixtures/errors/root.svelte'),
}

const rpc: RemoteRoutes = {
    '/rpc/http-echo': async () => ({ echo }),
    '/rpc/http-fast': async () => ({ fastData }),
}

/* Pulls the parsed `window.__SSR__` state object out of a rendered document. */
function ssrState(html: string): Record<string, unknown> | undefined {
    const match = html.match(/window\.__SSR__ = (.+?);<\/script>/)
    return match ? JSON.parse(match[1]) : undefined
}

describe('createServer over HTTP', () => {
    let origin: string
    let stop: () => void

    beforeAll(async () => {
        const booted = await bootTestServer({ pages, layouts, errors, rpc })
        origin = booted.origin
        stop = booted.stop
    })
    afterAll(() => {
        stop()
    })

    test('renders a page inside the nearest layout with SSR state', async () => {
        const res = await fetch(`${origin}/`)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toContain('text/html')
        const html = await res.text()
        expect(html).toContain('data-layout="root"')
        expect(html).toContain('data-page="home"')
        const state = ssrState(html)
        expect(state?.route).toBe('/')
        expect(state?.params).toEqual({})
    })

    test('decodes a dynamic segment into params and page props', async () => {
        const res = await fetch(`${origin}/post/123`)
        const html = await res.text()
        expect(html).toContain('post-123')
        const state = ssrState(html)
        expect(state?.route).toBe('/post/[id]')
        expect(state?.params).toEqual({ id: '123' })
    })

    test('reconstructs a [...rest] catch-all across segments', async () => {
        const res = await fetch(`${origin}/docs/a/b/c`)
        const html = await res.text()
        expect(html).toContain('docs-a/b/c')
        const state = ssrState(html)
        expect(state?.route).toBe('/docs/[...rest]')
        expect(state?.params).toEqual({ rest: 'a/b/c' })
    })

    test('nearest layout wins — deeper prefix replaces the root layout', async () => {
        const html = await fetch(`${origin}/admin`).then((res) => res.text())
        expect(html).toContain('data-layout="admin"')
        expect(html).not.toContain('data-layout="root"')
    })

    test('Accept: application/json on a page answers route + params as JSON', async () => {
        const res = await fetch(`${origin}/post/9`, {
            headers: { accept: 'application/json' },
        })
        expect(res.headers.get('vary')).toBe('Accept')
        expect(await res.json()).toEqual({ route: '/post/[id]', params: { id: '9' } })
    })

    test('non-GET/HEAD on a page is 405 with an Allow header', async () => {
        const res = await fetch(`${origin}/admin`, { method: 'POST' })
        expect(res.status).toBe(405)
        expect(res.headers.get('allow')).toBe('GET, HEAD')
    })

    test('unknown route renders the nearest error.svelte as a 404', async () => {
        const res = await fetch(`${origin}/nope`)
        expect(res.status).toBe(404)
        const html = await res.text()
        expect(html).toContain('data-error')
        expect(html).toContain('404:Not Found')
        // Static error document: client skips hydration.
        expect(ssrState(html)?.error).toBe(true)
    })

    test('a throw during page render becomes a 500 error.svelte with the message', async () => {
        const res = await fetch(`${origin}/boom`)
        expect(res.status).toBe(500)
        const html = await res.text()
        expect(html).toContain('500:boom render')
    })

    test('dispatches an rpc verb over HTTP', async () => {
        const res = await fetch(`${origin}/rpc/http-echo`)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ echoed: true })
    })

    test('method mismatch on an rpc URL is 405 naming the verb', async () => {
        const res = await fetch(`${origin}/rpc/http-echo`, { method: 'POST' })
        expect(res.status).toBe(405)
        expect(res.headers.get('allow')).toBe('GET')
    })

    test('identity probe answers ahead of routing', async () => {
        const res = await fetch(`${origin}/__belte/identity`)
        const body = await res.json()
        /* The alias keeps the legacy shape shipped probers check strictly. */
        expect(body.belte).toBe(true)
    })

    test('an awaited cache read settles during render and ships inline in __SSR__', async () => {
        const res = await fetch(`${origin}/settled`)
        const html = await res.text()
        expect(html).toContain('settled-1')
        const state = ssrState(html)
        const inline = state?.cache as Array<{ url: string; method: string; body: string }>
        expect(inline).toHaveLength(1)
        // Snapshot URLs are absolute — the synthesized Request's full href.
        expect(new URL(inline[0].url).pathname).toBe('/rpc/http-fast')
        expect(inline[0].method).toBe('GET')
        expect(JSON.parse(inline[0].body)).toEqual({ n: 1 })
        // Nothing pending: no streaming placeholders, no resolve token.
        expect(state?.streaming).toEqual([])
        expect(state?.streamToken).toBeUndefined()
    })

    test('a second request gets a fresh request-scoped cache (handler re-runs)', async () => {
        const html = await fetch(`${origin}/settled`).then((res) => res.text())
        expect(html).toContain('settled-2')
    })
})
