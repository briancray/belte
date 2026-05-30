import { bindConnectedFlag } from './lib/bundle/bindConnectedFlag.ts'
import { bindRequestNavigate } from './lib/bundle/bindRequestNavigate.ts'
import { findFreePort } from './lib/bundle/findFreePort.ts'
import { listenLocalControlServer } from './lib/bundle/listenLocalControlServer.ts'
import { probeBelteServer } from './lib/bundle/probeBelteServer.ts'
import { resolveServerBinary } from './lib/bundle/resolveServerBinary.ts'
import { resolveWebviewLib } from './lib/bundle/resolveWebviewLib.ts'
import { stableLocalPort } from './lib/bundle/stableLocalPort.ts'
import { waitForServer } from './lib/bundle/waitForServer.ts'
import { log } from './lib/shared/log.ts'

/*
The bundle's control server, run in a Worker so it owns its own thread.

`webview_run` enters a native UI run loop that blocks the launcher's main thread
indefinitely (the window owns it until close), which freezes the main thread's
JS event loop. An in-process `Bun.serve` there can never answer a request, so the
webview pointed at it would only ever see a hung navigation — a blank window.

Running the control server on this Worker thread keeps it answering the whole time
the window is open. It owns the pieces that must live beside it: the embedded
server child it spawns, and its own FFI handle to the native menu flag (set here
because the main thread can't process a postMessage while blocked in webview_run,
yet the flag is a process-global the main-thread menu still reads).

Bun does not apply the launcher build's plugins to a worker entry, so this module
can't import belte's virtual modules (the connect-screen HTML, app title). The
launcher — which can — passes them in the `init` message; on `shutdown` it has us
reap the embedded child before the launcher exits.

Once connected it also watches the chosen server's liveness — polling its identity
endpoint — and, when it stops answering, corrects the menu flag and bounces the
window back to the connect screen, since a dead server (local crash or remote
outage) otherwise leaves a frozen page and a menu that still claims connected.

  GET  /                   → the connect screen (title injected at serve time)
  POST /connect {url}      → record connected, reply { redirect: url }
  POST /start              → spawn the server binary, reply { redirect: localUrl }
  GET  /__belte/disconnect → reap the child, clear connected
*/

// Init payload from the launcher, plus the per-run state the handlers close over.
type Init = { disconnectedHtml: string; title: string; programName: string }
let disconnectedHtml = ''
let title = ''
let flag: ReturnType<typeof bindConnectedFlag> | undefined
let server: ReturnType<typeof listenLocalControlServer> | undefined

// The control-server origin (where the connect screen lives) and the webview
// handle, forwarded by the launcher — together they let the watch bounce a dead
// window back to the connect screen.
let controlOrigin = ''
let navigate: ReturnType<typeof bindRequestNavigate> | undefined
let webviewHandle: number | undefined

/*
Liveness watch over the currently-connected server. A recursive timer (not
setInterval, so a slow probe never overlaps the next) probes the identity endpoint;
a couple of consecutive misses — tolerating a transient blip or a quick restart —
count as a death. Cleared whenever we're not connected.
*/
const LIVENESS_INTERVAL_MS = 4000
const LIVENESS_FAILURE_LIMIT = 2
let connectedUrl: string | undefined
let livenessTimer: ReturnType<typeof setTimeout> | undefined
let livenessFailures = 0

// Embedded-server child, spawned on demand by Start server; undefined when none.
let serverChild: ReturnType<typeof Bun.spawn> | undefined

// Reaps the embedded server child if one is running.
function killServerChild(): void {
    if (serverChild) {
        serverChild.kill()
        serverChild = undefined
    }
}

// Begin (or restart) watching `url` for liveness once the window points at it.
function startLivenessWatch(url: string): void {
    stopLivenessWatch()
    connectedUrl = url
    livenessFailures = 0
    livenessTimer = setTimeout(runLivenessProbe, LIVENESS_INTERVAL_MS)
}

// Stop watching — on explicit disconnect, on detected death, or at shutdown.
function stopLivenessWatch(): void {
    if (livenessTimer) {
        clearTimeout(livenessTimer)
        livenessTimer = undefined
    }
    connectedUrl = undefined
    livenessFailures = 0
}

/*
One liveness probe of the connected server. Successes reset the miss count;
LIVENESS_FAILURE_LIMIT consecutive misses declare it dead and hand off to
handleConnectionLost. Reschedules itself while still connected.
*/
async function runLivenessProbe(): Promise<void> {
    const url = connectedUrl
    if (!url) {
        return
    }
    const identity = await probeBelteServer(url)
    // A disconnect or reconnect during the await may have moved us on.
    if (connectedUrl !== url) {
        return
    }
    if (identity) {
        livenessFailures = 0
    } else {
        livenessFailures += 1
        if (livenessFailures >= LIVENESS_FAILURE_LIMIT) {
            handleConnectionLost(url)
            return
        }
    }
    livenessTimer = setTimeout(runLivenessProbe, LIVENESS_INTERVAL_MS)
}

/*
The connected server stopped answering. Reap any (now-dead) embedded child, clear
the connected flag so the menu stops claiming connected, and bounce the window
back to the connect screen with a `lost` notice. The flag flip alone keeps the
menu honest even when the navigate is a no-op (off macOS, or no handle yet).
*/
function handleConnectionLost(url: string): void {
    log.warn(`connected server stopped responding: ${url}`)
    stopLivenessWatch()
    killServerChild()
    flag?.setConnected(false)
    if (webviewHandle !== undefined) {
        navigate?.requestNavigate(webviewHandle, `${controlOrigin}/?action=lost`)
    }
}

/*
Spawns the sibling server binary on a free port and waits for it to answer,
returning the URL to point the window at. Any previous child is reaped first so
only one embedded server runs at a time.
*/
async function startEmbeddedServer(): Promise<string> {
    killServerChild()
    const port = findFreePort()
    const url = `http://localhost:${port}`
    serverChild = Bun.spawn({
        cmd: [resolveServerBinary()],
        // BELTE_PARENT_PID lets the child exit if the launcher is force-quit
        // (a clean window close reaps it directly; see exitWithParent).
        env: { ...process.env, PORT: String(port), BELTE_PARENT_PID: String(process.pid) },
        stdio: ['inherit', 'inherit', 'inherit'],
    })
    await waitForServer(url)
    return url
}

/*
Injects the app title into the connect-screen HTML just before serving — the build
left a `<!--belte:connect-config-->` marker in <head>.
*/
function renderConnectScreen(): Response {
    const script = `<script>window.__BELTE_TITLE__=${JSON.stringify(title)}</script>`
    const html = disconnectedHtml.replace('<!--belte:connect-config-->', script)
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

/*
The control server's request handler. The connect screen owns localStorage +
navigation; this worker owns the embedded-server process and the native flag.
*/
async function handleControlRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/') {
        return renderConnectScreen()
    }
    if (request.method === 'POST' && url.pathname === '/connect') {
        const { url: target } = (await request.json()) as { url: string }
        // Verify it's actually a belte server before pointing the window at it.
        const identity = await probeBelteServer(target)
        if (!identity) {
            log.warn(`no belte server responded at ${target}`)
            return Response.json(
                { error: `No belte server responded at ${target}` },
                { status: 502 },
            )
        }
        flag?.setConnected(true)
        startLivenessWatch(target)
        log.info(`connecting to ${identity.name} at ${target}`)
        return Response.json({ redirect: target })
    }
    if (request.method === 'POST' && url.pathname === '/start') {
        try {
            const localUrl = await startEmbeddedServer()
            flag?.setConnected(true)
            startLivenessWatch(localUrl)
            log.info(`started embedded server at ${localUrl}`)
            return Response.json({ redirect: localUrl })
        } catch (error) {
            killServerChild()
            return Response.json({ error: String(error) }, { status: 500 })
        }
    }
    if (request.method === 'GET' && url.pathname === '/__belte/disconnect') {
        stopLivenessWatch()
        killServerChild()
        flag?.setConnected(false)
        return new Response(undefined, { status: 204 })
    }
    return new Response('not found', { status: 404 })
}

/*
Bind the control server to 127.0.0.1 literally (not `localhost`) so the webview
reaches it without any IPv4/IPv6 name-resolution ambiguity, open the native flag
handle, and hand the launcher the origin to navigate the window at.
*/
async function start(init: Init): Promise<void> {
    disconnectedHtml = init.disconnectedHtml
    title = init.title
    const libPath = await resolveWebviewLib()
    flag = bindConnectedFlag(libPath)
    navigate = bindRequestNavigate(libPath)
    server = listenLocalControlServer(stableLocalPort(init.programName), handleControlRequest)
    controlOrigin = `http://127.0.0.1:${server.port}`
    log.info(`${title} control server listening at ${controlOrigin}`)
    self.postMessage({ type: 'ready', origin: controlOrigin })
}

// Reap the child + release the server and FFI handles, then confirm so the
// launcher can exit cleanly.
function shutdown(): void {
    stopLivenessWatch()
    killServerChild()
    server?.stop(true)
    flag?.close()
    navigate?.close()
    self.postMessage({ type: 'shutdownDone' })
}

/*
The launcher drives the lifecycle: `init` (with the data this worker can't import)
starts the server, `window` forwards the webview handle the liveness watch needs to
navigate, and `shutdown` tears it all down once the window closes.
*/
self.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as
        | { type: 'init'; init: Init }
        | { type: 'window'; handle: number }
        | { type: 'shutdown' }
    if (data.type === 'init') {
        void start(data.init)
    } else if (data.type === 'window') {
        webviewHandle = data.handle
    } else if (data.type === 'shutdown') {
        shutdown()
    }
})
