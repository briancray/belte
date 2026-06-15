import { buildClient, renderShell, serve } from './server.ts'

/*
Verifies the example runs through the real pipeline without a long-lived server:
builds the client bundle (real Bun.build + belteUiPlugin), server-renders the
shell (compileSSR), then briefly serves and fetches the page. Run:

  bun examples/belte-ui-demo/verify.ts
*/

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(`FAIL: ${message}`)
    }
    console.log(`ok: ${message}`)
}

/* 1) the .belte component bundles through the real loader + resolver */
const clientJs = await buildClient()
assert(clientJs.length > 0, 'client bundle built via Bun.build + belteUiPlugin')
assert(clientJs.includes('mount('), 'bundle wires the mount runtime')
assert(clientJs.includes('.cell('), 'bundle uses hoisted cells (compiled fast path)')

/* 2) the component server-renders to correct HTML */
const shell = await renderShell()
assert(shell.includes('<button>count: 0</button>'), 'SSR rendered the counter button')
assert(shell.includes('belte-ui demo'), 'SSR rendered the heading')
assert(shell.includes('no items yet'), 'SSR rendered the else branch (empty list)')

/* 3) the server returns the full page over real HTTP */
const server = await serve(0)
const response = await fetch(server.url)
const body = await response.text()
server.stop()
assert(body.includes('<div id="app">'), 'page wraps the SSR shell in #app')
assert(body.includes('count: 0'), 'page includes the server-rendered markup')
assert(body.includes('<script type="module">'), 'page includes the client bundle')

console.log('\nbelte-ui demo: real pipeline verified ✓')
