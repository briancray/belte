import { buildClient, renderShell, serve } from './server.ts'

/*
Verifies the multi-page example runs through the real pipeline without a
long-lived server: builds the client bundle (real Bun.build + belteUiPlugin),
server-renders each route (compileSSR), then briefly serves and fetches both.
Run: bun examples/belte-ui-demo/verify.ts
*/

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(`FAIL: ${message}`)
    }
    console.log(`ok: ${message}`)
}

/* 1) both pages + the router bundle through the real loader + resolver */
const clientJs = await buildClient()
assert(clientJs.includes('mount('), 'bundle wires the mount runtime')
assert(clientJs.includes('.cell('), 'bundle uses hoisted cells (compiled fast path)')
assert(clientJs.includes('popstate'), 'bundle includes the router')

/* 2) each route server-renders to correct HTML */
const home = await renderShell('/')
assert(home.includes('<button>count: 0</button>'), 'home SSR rendered the counter')
assert(home.includes('about →'), 'home SSR rendered the nav link')

const about = await renderShell('/about')
assert(about.includes('<h1>about</h1>'), 'about SSR rendered its heading')
assert(about.includes('belte-ui router'), 'about SSR interpolated its prop/derived')

/* 3) the server returns each route over real HTTP */
const server = await serve(0)
const homePage = await (await fetch(`${server.url}`)).text()
const aboutPage = await (await fetch(`${server.url}about`)).text()
server.stop()
assert(
    homePage.includes('count: 0') && homePage.includes('<script type="module">'),
    'GET / served the home page + bundle',
)
assert(aboutPage.includes('<h1>about</h1>'), 'GET /about served the about page')

console.log('\nbelte-ui demo: multi-page real pipeline verified ✓')
