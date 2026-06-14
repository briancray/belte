/*
Test module — `createTestApp()` boots your real app on an ephemeral port (the
same wiring as `belte start`, no fixtures) and hands back the whole surface:

  app.fetch(path)        — pages and raw HTTP, origin + mount base resolved
  app.rpc.<verb>(args)   — verbs over the real pipeline (CSRF, cookies, base),
                           typed and decoded; .raw(args) for the Response
  app.sockets.<name>     — a live Socket: iterate it, .tail(n), .publish(m)
  app.health()           — the /__belte/health payload

`app.rpc` / `app.sockets` are typed from your own verbs and sockets — generated
into src/.belte during a build, so the keys exist with no imports. The belte
preload (see bunfig.toml) makes the project's routes resolvable under bun test.

`await using` disposes the app (server + restored slots) when the block ends,
so a thrown assertion still releases the port.
*/
import { expect, test } from 'bun:test'
import { createTestApp } from '@belte/belte/test/createTestApp'

test('serves the home page', async () => {
    await using app = await createTestApp()
    const html = await (await app.fetch('/')).text()
    expect(html).toContain('Hello from belte')
})

test('getHello returns the greeting', async () => {
    await using app = await createTestApp()
    expect(await app.rpc.getHello()).toEqual({ message: 'Hello from belte' })
})
