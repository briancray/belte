# Belte

Isomorphic multimodal http framework built for humans and machines in a single Bun runtime.

One Bun process serves every surface an app needs — to people and to programs:

| | Surfaces | Reached as |
| --- | --- | --- |
| **Humans** | web · cli · bundle | server-rendered Svelte, a terminal command, a movable desktop app |
| **Machines** | mcp · cli | MCP tools and scripted CLI calls against the same handlers |

Declare an rpc or socket once; belte derives every surface from it (see below).

## Try it

The fastest path is a prebuilt example.

Scaffold a new project:

```sh
bunx @briancray/belte scaffold my-app
cd my-app && bun install
bun dev
```

Or clone the repo and run the kitchen-sink, which exercises every feature in one app:

```sh
git clone https://github.com/briancray/belte
cd belte/examples/kitchen-sink
bun dev
```

## What is an isomorphic multimodal framework

- **One runtime.** Dev and build run the same server code; there is no separate "dev mode" behavior to drift from production.
- **Declare once, use anywhere.** A single rpc declaration becomes a browser call, an HTTP route, an MCP tool, a CLI command, and an OpenAPI operation — no per-surface wiring.
- **Isomorphic by default.** The same import resolves to a server handler or a network proxy depending on the build target. Your code reads the same on both sides.

Declare a remote function in a file under `src/server/rpc/`:

```ts
// src/server/rpc/getProduct.ts
import { GET } from 'belte/server/GET'
import { json } from 'belte/server/json'
import { error } from 'belte/server/error'
import { z } from 'zod'

const inputSchema = z.object({ id: z.string() })

export const getProduct = GET(
    ({ id }) => {
        const product = products[id]
        if (!product) {
            return error(404, `no product ${id}`)
        }
        return json(product)
    },
    { inputSchema },
)
```

That one file is consumable on every client:

| Surface | How it is reached |
| --- | --- |
| Browser / SSR | `import { getProduct } from '$server/rpc/getProduct.ts'` then `await getProduct({ id })` |
| HTTP | `GET /rpc/getProduct?id=1` |
| MCP | tool `getProduct` (auto-exposed: read-only verb with a schema) |
| CLI | `my-app getProduct --id=1` |
| OpenAPI | operation in `/openapi.json` |

The browser call runs the handler in-process during SSR and becomes a typed `fetch` after hydration — same line of code.

---

## Server

### Server / rpc

#### Declaring

Every file under `src/server/rpc/` exports exactly one verb-bound remote function. The filename is the export name and the URL (mounted under `/rpc/`); the imported verb picks the HTTP method.

```ts
type VerbHelper = (fn, opts?) => RemoteFunction
```

| Arg | Type | Meaning |
| --- | --- | --- |
| `fn` | `(args) => Response \| Promise<Response>` | Handler. Returns a `Response` (use the helpers below). |
| `opts.inputSchema` | Standard Schema | Validates inbound args; 422 on failure. `Args` infers from it. Auto-exposes the verb to CLI (and MCP if read-only). |
| `opts.outputSchema` | Standard Schema | Describes the success body for the OpenAPI 200 response and the MCP tool output. |
| `opts.clients` | `Partial<{ browser, mcp, cli }>` | Override which surfaces expose this verb. Explicit values always win. |

Verbs: `belte/server/GET`, `belte/server/POST`, `belte/server/PUT`, `belte/server/PATCH`, `belte/server/DELETE`, `belte/server/HEAD`. Each is a separate module — import only what you use.

```ts
// src/server/rpc/createEcho.ts
import { POST } from 'belte/server/POST'
import { json } from 'belte/server/json'
import { z } from 'zod'

const inputSchema = z.object({ message: z.string() })

// Mutating verbs aren't auto-exposed to MCP — opt in explicitly.
export const createEcho = POST(
    ({ message }) => json({ message }, { status: 201 }),
    { inputSchema, clients: { mcp: true } },
)
```

Args arrive as the handler's first parameter: `undefined` for query-less GET/DELETE, a parsed object for JSON or form bodies. For binary or multipart bodies, read the raw `Request` via `request()`.

**Response helpers** — each is its own module, returns a branded `Response` so `Return` infers through to the caller:

| Helper | Module | Produces |
| --- | --- | --- |
| `json(data, init?)` | `belte/server/json` | `application/json`, `Cache-Control: no-store` |
| `error(status, message?, init?)` | `belte/server/error` | `text/plain` error; caller's `await` throws `HttpError` |
| `redirect(url, status?, init?)` | `belte/server/redirect` | 3xx (default 302); accepts relative URLs |
| `jsonl(asyncIterable, init?)` | `belte/server/jsonl` | `application/jsonl` stream, one JSON value per line |
| `sse(asyncIterable, init?)` | `belte/server/sse` | `text/event-stream` with 15s keepalive |

**Request context** — both throw if called outside a request scope:

```ts
import { request } from 'belte/server/request' // inbound Request: headers, signal, body
import { server } from 'belte/server/server'   // the live Bun.Server instance
```

#### Consuming

A plain call encodes args (query string for GET/HEAD/DELETE, JSON or form body for POST/PUT/PATCH) and decodes the response by Content-Type — JSON to an object, `text/*` to a string, otherwise a `Blob`, `undefined` for 204. Non-2xx throws `HttpError`.

```ts
import { getProduct } from '$server/rpc/getProduct.ts'

const product = await getProduct({ id: '1' }) // decoded body; throws HttpError on non-2xx
```

**`.raw(args?)`** — same method, url, and args, but resolves to the underlying `Response` with no decode and no throw on non-2xx. For status, headers, or custom error handling.

```ts
const response = await getProduct.raw({ id: '1' })
const version = response.headers.get('x-report-version')
```

**`.stream(args?)`** — returns a `Subscribable<T>` view of the body: SSE/JSONL handlers yield each frame; non-streaming handlers yield the decoded body once. Pass it to `subscribe()` or iterate directly.

```ts
for await (const frame of tickFeed.stream()) {
    console.log(frame)
}
```

**`HttpError`** (`belte/browser/HttpError`) — thrown on non-2xx. Carries `status`, `statusText`, and the raw `response` for building error UI.

**`/openapi.json`** — an OpenAPI 3 document of the public `/rpc/*` surface, served at the conventional root path for external tooling.

### Server / sockets

#### Declaring

Every file under `src/server/sockets/` exports one named broadcast socket. The filename is the socket's identity.

```ts
type socket = <T>(opts?: SocketOptions) => Socket<T>
```

| Option | Type | Meaning |
| --- | --- | --- |
| `history` | `number` | Items retained and replayed to new subscribers. Default `0`. |
| `ttl` | `number` | Ms before a history entry is evicted (lazily, on read/append). |
| `clientPublish` | `boolean` | Allow browsers to publish directly. Default `false`. |
| `schema` | Standard Schema | Validates publish payloads synchronously; auto-exposes the socket to MCP and CLI. |
| `clients` | `Partial<{ browser, mcp, cli }>` | Override exposed surfaces. |

```ts
// src/server/sockets/chat.ts
import { socket } from 'belte/server/socket'
import { z } from 'zod'

export type ChatMessage = { from: string; text: string; at: number }

export const chat = socket<ChatMessage>({
    history: 100,
    schema: z.object({ from: z.string(), text: z.string(), at: z.number() }),
})
```

#### Publishing

```ts
type publish = (message: T) => void
```

`publish` is isomorphic. Called server-side it notifies in-process iterators and broadcasts to remote subscribers over Bun's native `server.publish`. Called client-side (when `clientPublish` is on) it sends a frame the dispatcher validates against the schema.

```ts
// inside an rpc handler — validate input, then fan out
chat.publish({ from, text, at: Date.now() })
```

#### Consuming

A `Socket<T>` is an `AsyncIterable<T>`. Iterating replays the history buffer, then tails live frames.

```ts
for await (const message of chat) {
    console.log(message)
}
```

**`.tail(count?)`** opens a subscription that replays only the last `count` items (default `0`, clamped to the configured `history`) before tailing.

```ts
for await (const message of chat.tail(10)) { /* last 10, then live */ }
```

In Svelte, drive it reactively with `subscribe()` (see below) rather than iterating by hand. For sustained pub/sub, prefer sockets over rpc streams — HTTP rpc isn't built for long-lived multi-publisher subscriptions.

---

## Clients

### Browser

Pages are Svelte 5 components under `src/browser/pages/`. Each folder containing a `page.svelte` mounts at that folder's URL; `[id]` segments become path params, `[...rest]` a catch-all.

```svelte
<!-- src/browser/pages/page.svelte → GET / -->
<script lang="ts">
import { cache } from 'belte/browser/cache'
import { getHello } from '$server/rpc/getHello.ts'

// Top-level await runs during SSR; the decoded body is serialized into the
// HTML and replayed on hydration — no second fetch.
const hello = await cache(getHello)()
</script>

<h1>{hello.message}</h1>
```

**Layouts** — a `layout.svelte` wraps every page at or below its folder; the nearest one wins. It renders `{@render children()}`.

**`cache(fn, options?)`** (`belte/browser/cache`) — curries a remote call against the request-scoped cache store. The outer call configures, the inner call invokes. Runs the same in SSR and in the browser.

```ts
type cache = (fn: RemoteFunction, options?: CacheOptions) => (args?) => Promise<Return>
```

| Option | Type | Meaning |
| --- | --- | --- |
| `key` | `string \| unknown[] \| object` | Override the auto-derived key (method + url + args). |
| `ttl` | `number` | Ms past resolve the entry lives. Omitted = forever; `0` = dedupe in-flight only. |

```ts
const post = await cache(getPost)({ id })        // decoded body
const res = await cache(getPost.raw)({ id })      // raw Response (shares the entry)
cache.invalidate(getPost)                         // drop every entry for this fn
```

**`subscribe(src)`** (`belte/browser/subscribe`) — reactive consumer for any `Subscribable<T>`: a socket or `fn.stream(args)`. The first read in a tracking scope opens the iterator; the last reader closes it. No-op during SSR.

```ts
type subscribe = <T>(src: Subscribable<T>) => T | undefined
```

```ts
const latest = $derived(subscribe(chat))
const status = $derived(subscribe.status(chat)) // 'pending' | 'open' | 'done' | 'error'
const failure = $derived(subscribe.error(chat))
```

**`navigate(href, options?)`** (`belte/browser/navigate`) — SPA navigation. Writes history, resolves the new view, and swaps the page component; a same-pathname change (only `search`/`hash`) skips the round-trip and just reassigns `page.url`. Falls back to a hard navigation on failure.

```ts
type navigate = (href: string, options?: { replace?: boolean; scroll?: boolean }) => Promise<void>
```

**Page state** (`belte/browser/page`) — a reactive `page` object: `route`, `params` (typed per route from generated types), and the live WHATWG `url`. Reassigned on every navigation, so reading it inside a `$derived` re-runs.

```ts
import { page } from 'belte/browser/page'
const active = $derived(page.url.pathname === '/server')
```

### MCP

Generated automatically — there is no server module to author. The endpoint lives at `/__belte/mcp`; auth inherits from the inbound request.

- **rpc → tools.** Every verb with `clients.mcp` exposed becomes a tool. Read-only verbs (GET/HEAD) with a schema auto-expose; mutating verbs opt in via `clients: { mcp: true }`. Sockets contribute a `<name>-tail` read tool (and `<name>-publish` when `clientPublish` is on).
- **Resources** — files under `src/mcp/resources/` are served as MCP resources under `belte://resources/<path>`. Text MIME types come back inline, everything else base64.

  ```md
  <!-- src/mcp/resources/about.md → belte://resources/about.md -->
  # About this app
  ```

- **Prompts** — markdown files under `src/mcp/prompts/`. Frontmatter declares `description` and `arguments`; the body interpolates `{{name}}` placeholders.

  ```md
  <!-- src/mcp/prompts/summarize.md -->
  ---
  description: Draft a request to summarize a topic.
  arguments:
    - name: topic
      description: the subject to summarize
      required: true
  ---
  Write a concise summary of {{topic}}.
  ```

### CLI

Generated automatically. `belte cli` builds a standalone thin binary that bakes in a per-rpc manifest and talks to a running server over HTTP — it carries no handler code.

- **Config.** The binary reads `APP_URL` (the server to call; required) and `APP_TOKEN` (bearer auth; optional) from the environment or a `.env` beside the binary.
- **rpc → commands.** Each exposed verb becomes a subcommand; args and flags derive from its schema (`--id=1`). Streaming verbs and socket `tail` commands print frames as NDJSON; other replies decode and pretty-print once.
- **Downloads.** A running server serves the binary at `/__belte/cli` (install script) and `/__belte/cli/<platform>` (a tarball with the binary plus a `.env` carrying `APP_URL`). An authenticated download bakes the request's bearer token into that `.env`.
- **Chrome.** Optional `src/cli/banner.txt` and `src/cli/footer.txt` wrap the top-level help output.

### Bundle

`belte bundle` produces a movable, self-contained native desktop app for the host platform — a `.app` on macOS, a flat directory elsewhere — carrying the server binary, the launcher, and the webview library together. It boots into a connect screen that either starts the embedded server or connects to a remote one.

**Window config** — optional `src/bundle/window.ts`, default-exported:

```ts
type BundleWindow = {
    title?: string
    width?: number
    height?: number
    menu?: BundleMenu[]
    config?: StandardSchema // env the embedded server needs; drives the first-run form
}
```

```ts
// src/bundle/window.ts
import type { BundleWindow } from 'belte/bundle/BundleWindow'
import { z } from 'zod'

export default {
    title: 'My App',
    width: 1280,
    height: 880,
    menu: [{ label: 'Demo', items: [{ label: 'Reload', shortcut: 'r', emit: 'reload' }] }],
    config: z.object({
        HOST_ROOT: z.string().meta({ title: 'Content folder' }),
    }),
} satisfies BundleWindow
```

- **`disconnected.svelte`** — drop a `src/bundle/disconnected.svelte` to replace the default connect screen.
- **`onMenu`** (`belte/bundle/onMenu`) — subscribe to custom menu clicks. Each item's `emit` name fires a `belte:menu` event; the handler returns an unsubscribe for `$effect`. Inert during SSR and in a plain browser tab.

  ```ts
  $effect(() => onMenu('reload', () => location.reload()))
  ```

- **`icon.png`** — `src/bundle/icon.png` (or a ready-made `icon.icns`) becomes the macOS app icon.

---

## Some details

### App hooks

An optional `src/app.ts` exports lifecycle hooks, resolved at build time (no import needed). All optional.

| Hook | Signature | Runs |
| --- | --- | --- |
| `init` | `({ server }) => void \| (() => void)` | Once after `Bun.serve` boots; returned function runs on shutdown. |
| `handle` | `(request, next) => Response` | Middleware wrapping every request; mutate the response or branch on the URL. |
| `handleError` | `(error, request) => Response` | Replaces the default 500 page. |

### Project layout

```
src/
  app.ts                  optional lifecycle hooks
  browser/
    pages/                page.svelte + layout.svelte → routes
    public/               static files served at the site root
    lib/                  page-side helpers
  server/
    rpc/                  one verb-bound remote function per file
    sockets/              one socket per file
    lib/                  server-side helpers
  mcp/
    resources/            files served as MCP resources
    prompts/              markdown prompt templates
  cli/                    banner.txt / footer.txt
  bundle/                 window.ts, disconnected.svelte, icon.png
```

A `lib/` folder may sit under each surface for that side's shared code. Path aliases (`$server`, `$browser`, `$shared`, `$mcp`, `$cli`) map to `src/<name>`.

### CLI commands

| Command | Does |
| --- | --- |
| `bunx @briancray/belte scaffold <name>` | Scaffold a new project. |
| `belte dev` | Build the client and run the server with hot reload. |
| `belte build` | Build the client into `dist/_app/`. |
| `belte start` | Run the production server against `dist/`. |
| `belte compile [--target] [--out]` | Build a standalone server executable (assets embedded). |
| `belte cli [--target] [--out] [--platforms=a,b,c]` | Build the thin CLI binary (needs `APP_URL` at runtime). |
| `belte bundle` | Build a self-contained desktop app for this platform. |

### Public files

Files under `src/browser/public/` are served at the site root (`public/robots.txt` → `/robots.txt`) with a short shared cache, sidestepping the request pipeline.

### Bundling

The client build (`belte build`) emits hashed chunks into `dist/_app/`, each with a zstd-compressed sibling streamed to capable clients. `belte compile` embeds those assets into a single server binary. `belte bundle` wraps that binary with the launcher and webview into a distributable app.

| Asset | Cache-Control |
| --- | --- |
| Hashed `/_app/` chunks | `public, max-age=31536000, immutable` |
| Unhashed `/_app/` entries (shell, entry bundle) | `public, max-age=0, must-revalidate` |
| `public/` files | `public, max-age=3600` |
| SSR HTML | `private, no-cache` |
| rpc replies / errors | `no-store` |

### Environment variables

| Variable | Read by | Meaning |
| --- | --- | --- |
| `PORT` | server | Listen port (default `3000`). |
| `APP_URL` | CLI | The server the CLI binary talks to (required). |
| `APP_TOKEN` | CLI | Bearer token sent with CLI requests. |
| `DEBUG` | server / build | Enables namespaced debug logging. |

A bundle layers config from several sources (later loses to earlier): a shell export, a CWD `.env`, the per-user data-dir `.env` (written by the connect screen's setup form), and the shipped `.env.bundle` default.

### Logging and DEBUG

Belte's shared logger prefixes `[belte]`, colors HTTP method/status, and prints request timing when debug logging is on. `DEBUG` follows the `debug` package conventions:

| `DEBUG` value | Enables |
| --- | --- |
| `belte` | the `belte` scope (request logging) |
| `belte:*` | `belte` and every `belte:`-prefixed scope |
| `*` | everything |
| `a,belte` | a comma-separated list |
