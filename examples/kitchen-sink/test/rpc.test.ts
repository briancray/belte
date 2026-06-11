import { describe, expect, test } from 'bun:test'
import { HttpError } from '@belte/belte/shared/HttpError'
import { createTestClient } from '@belte/belte/test/createTestClient'

/*
Importing the rpc modules registers their verbs — the belte preload (see
bunfig.toml) rewrites each GET/POST into a defineVerb call, the same swap the
server build does — so createTestClient routes to them by command name without
a running server.
*/
import '$server/rpc/createEcho.ts'
import '$server/rpc/getProduct.ts'

/*
The client discovers verbs from the registry and routes through the same
synthesize-and-fetch path the CLI and MCP surfaces use. Each property is a
callable keyed by command name; `.raw` returns the underlying Response.
*/
const client = createTestClient()

describe('rpc in-process', () => {
    test('getProduct decodes the JSON body', async () => {
        expect(await client.getProduct({ id: '1' })).toEqual({
            id: '1',
            name: 'Stroopwafel',
            price: 4,
        })
    })

    test('a missing product throws HttpError(404)', async () => {
        expect(client.getProduct({ id: 'nope' })).rejects.toBeInstanceOf(HttpError)
    })

    test('.raw exposes the underlying Response status', async () => {
        const created = await client.createEcho.raw({ message: 'hi' })
        expect(created.status).toBe(201)
    })
})
