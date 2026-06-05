# Belte

Isomorphic multimodal HTTP framework built for humans and machines in a single [Bun](https://bun.sh) runtime.

Belte is one runtime that serves both audiences from one declaration:

- **Humans** — a Svelte web app (SSR + SPA), an interactive CLI, and a self-contained desktop bundle.
- **Machines** — an MCP server and a scriptable CLI.

The CLI serves both: a human runs it interactively, a script drives it one-shot. You declare an RPC once and every surface gets it for free.

## Try it

The fastest path is a prebuilt example. Otherwise scaffold a fresh app:

```sh
bunx @briancray/belte scaffold my-app
cd my-app && bun install
bun dev
```

The kitchen-sink example exercises every feature in one app:

```sh
git clone https://github.com/briancray/belte
cd belte/examples/kitchen-sink && bun dev
```

## What is an isomorphic multimodal framework

One runtime, one declaration, many consumers. You write a handler once; the bundler swaps its implementation per build target so the same callable runs in-process on the server and over the network in the browser, while the CLI and MCP surfaces derive themselves from the same registry.

Every public name carries the side it runs on in its import path — there is no umbrella barrel, so importing one name never drags in its siblings:

| Namespace | Runs | Examples |
| --- | --- | --- |
| `@briancray/belte/server/*` | server only | `GET`, `socket`, `json`, `request`, `cookies`, `env` |
| `@briancray/belte/browser/*` | client only | `page`, `navigate`, `subscribe` |
| `@briancray/belte/shared/*` | isomorphic (same callable, same behaviour both sides) | `cache`, `HttpError`, `withJsonSchema` |

Declare an RPC once, in a file under `src/server/rpc/`:

```ts
// src/server/rpc/getOrder.ts
import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'
import { error } from '@briancray/belte/server/error'

export const getOrder = GET<{ id: string }>(async ({ id }) => {
    const order = await db.getOrder(id)
    if (!order) return error(404, 'order not found')
    return json(order)
})
```

Consume the same `getOrder` on every surface:

| Surface | How it consumes |
| --- | --- |
| Browser / SSR | `await getOrder({ id })` — fetch over HTTP; `cache(getOrder)({ id })` to dedupe + hydrate |
| HTTP | `GET /rpc/getOrder?id=...` — flat URL from the file path |
| MCP | exposed as a tool (read-only verbs with a schema auto-expose) |
| CLI | `my-app getOrder --id ...` — flags derived from the schema |

## Server

### RPC

#### Declaring

Each file under `src/server/rpc/` exports exactly one verb-bound remote function, named after the file. The export name is the URL path (mounted under `/rpc/`) and the imported verb picks the HTTP method.

```ts
type VerbHelper = <Return, InputSchema>(
    fn: (args) => TypedResponse<Return> | Promise<TypedResponse<Return>>,
    opts?: {
        inputSchema?: StandardSchemaV1
        outputSchema?: StandardSchemaV1
        filesSchema?: StandardSchemaV1
        clients?: Partial<{ browser: boolean; mcp: boolean; cli: boolean }>
    },
) => RemoteFunction<Args, Return>
```

| Verb import | Method | Args carried as |
| --- | --- | --- |
| `@briancray/belte/server/GET` | `GET` | query string |
| `@briancray/belte/server/DELETE` | `DELETE` | query string |
| `@briancray/belte/server/HEAD` | `HEAD` | query string |
| `@briancray/belte/server/POST` | `POST` | `application/json` body |
| `@briancray/belte/server/PUT` | `PUT` | `application/json` body |
| `@briancray/belte/server/PATCH` | `PATCH` | `application/json` body |

| Option | Effect |
| --- | --- |
| `inputSchema` | Standard Schema validated before the handler; `Args` infers from it; failure → `422`. Feeds the OpenAPI request, MCP tool input, CLI flags. |
| `outputSchema` | Standard Schema for the success body — feeds the OpenAPI `200` and MCP tool `outputSchema`. |
| `filesSchema` | Standard Schema for `File` parts of a multipart upload, merged into the handler's args bag. Stays off the JSON-Schema projection. |
| `clients` | Which surfaces expose the verb. Defaults: browser always; CLI on when a schema is present; MCP on for read-only (`GET`/`HEAD`) verbs with a schema. Explicit values win. |

`Args` comes from the handler parameter type (or `inputSchema`); `Return` is inferred from the response helper's `TypedResponse<T>` brand, so a plain `GET(() => json({...}))` types end-to-end with no annotation.

```ts
import { POST } from '@briancray/belte/server/POST'
import { json } from '@briancray/belte/server/json'
import { z } from 'zod'

export const createOrder = POST(async ({ sku, qty }) => json(await db.create(sku, qty)), {
    inputSchema: z.object({ sku: z.string(), qty: z.number().int().positive() }),
})
```

**Response helpers** (one export per file, each returns a `TypedResponse<T>` defaulting `Cache-Control: no-store`):

| Helper | Import | Returns |
| --- | --- | --- |
| `json(data, init?)` | `@briancray/belte/server/json` | `application/json` |
| `error(status, message?, init?)` | `@briancray/belte/server/error` | `text/plain`; client call throws `HttpError` |
| `redirect(url, status?, init?)` | `@briancray/belte/server/redirect` | 3xx (default `302`); relative URLs allowed |
| `jsonl(iterable, init?)` | `@briancray/belte/server/jsonl` | `application/jsonl` stream, one JSON value per line |
| `sse(iterable, init?)` | `@briancray/belte/server/sse` | `text/event-stream`, one `data:` event per frame |

A bare `new Response(...)` is also accepted; its `Return` falls back to `unknown`.

**Request context** — handlers receive a parsed `args` bag, not the `Request`. Reach the ambient request via these zero-arg accessors (each throws outside a request scope):

| Function | Import | Returns |
| --- | --- | --- |
| `request()` | `@briancray/belte/server/request` | the inbound `Request` (headers, `signal`, raw body) |
| `cookies()` | `@briancray/belte/server/cookies` | Bun `CookieMap`; writes flush as `Set-Cookie` on the way out |
| `server()` | `@briancray/belte/server/server` | the active `Bun.Server` |

```ts
import { cookies } from '@briancray/belte/server/cookies'

const jar = cookies()
const session = jar.get('session')
jar.set('session', token, { httpOnly: true, sameSite: 'lax' })
```

**File uploads (`filesSchema`)** — text fields and `File` parts ship as one `FormData`; the server validates text against `inputSchema`, files against `filesSchema`, and merges both into the handler args:

```ts
export const upload = POST(async ({ title, avatar }) => json(await store(title, avatar)), {
    inputSchema: z.object({ title: z.string() }),
    filesSchema: z.object({ avatar: z.instanceof(File) }),
})
// call site: upload(formData)
```

**`withJsonSchema`** — JSON Schema is projected from each schema's own `toJSONSchema()` (Zod 4 / Effect / Arktype carry one). Wrap a schema whose library lacks it:

```ts
import { withJsonSchema } from '@briancray/belte/shared/withJsonSchema'

const schema = withJsonSchema(vSchema, (s) => toJsonSchema(s))
```

#### Consuming

A `RemoteFunction` is the same callable on both sides:

```ts
type RemoteFunction<Args, Return> = ((args: Args | FormData) => Promise<Return>) & {
    readonly method: HttpVerb
    readonly url: string
    readonly raw: RawRemoteFunction<Args>
    stream(args?: Args | FormData): Subscribable<Return>
}
```

The plain call encodes args (query string for `GET`/`DELETE`/`HEAD`, JSON body for `POST`/`PUT`/`PATCH`), then decodes the response by `Content-Type` and throws `HttpError` on non-2xx:

| Response `Content-Type` | Decoded value |
| --- | --- |
| `application/json`, `*/+json` | parsed object |
| `text/*` | string |
| `204` / empty | `undefined` |
| anything else | `Blob` |
| SSE / JSONL | throws — use `.stream` instead |

```ts
const order = await getOrder({ id: '7' }) // → decoded body, throws HttpError on 4xx/5xx
```

`.raw(args)` returns the underlying `Response` untouched (no decode, no throw) for callers needing status, headers, or body streaming:

```ts
const response = await getOrder.raw({ id: '7' })
if (response.status === 404) { /* … */ }
```

`.stream(args)` returns a `Subscribable<Return>` view of the body — SSE/JSONL handlers yield each frame, non-streaming handlers yield the decoded body once. Pass it to `subscribe()` for a reactive view:

```ts
import { subscribe } from '@briancray/belte/browser/subscribe'
const latest = $derived(subscribe(orderFeed.stream({ id: '7' })))
```

**`HttpError`** (`@briancray/belte/shared/HttpError`) carries the raw `Response` so error UI can inspect it without opting into `.raw`:

```ts
import { HttpError } from '@briancray/belte/shared/HttpError'

try {
    await getOrder({ id })
} catch (err) {
    if (err instanceof HttpError && err.status === 404) showNotFound()
}
```

**`openapi.json`** — the app's public `/rpc/*` surface is described at `GET /openapi.json` (alongside `/swagger.json`), built from each verb's `inputSchema` / `outputSchema`.

### Sockets

A bidirectional named broadcast primitive. Use it for sustained pub/sub — HTTP RPC streams are for per-call iteration, not long-lived multi-publisher subscriptions.

#### Declaring

Each file under `src/server/sockets/` exports one socket, named after the file.

```ts
type socket = <T>(opts?: {
    history?: number
    ttl?: number
    clientPublish?: boolean
    schema?: StandardSchemaV1
    clients?: Partial<{ browser: boolean; mcp: boolean; cli: boolean }>
}) => Socket<T>
```

| Option | Effect |
| --- | --- |
| `history` | Items buffered and replayed to a new subscriber (default `0`). |
| `ttl` | Milliseconds a history entry survives; evicted lazily on read/append. |
| `clientPublish` | Allow clients to publish over the wire (default `false` — server-only). |
| `schema` | Standard Schema validating publish payloads; `T` infers from it; enables MCP/CLI exposure. |
| `clients` | Which surfaces advertise the socket. Defaults: browser; MCP/CLI on when a schema is present. |

```ts
// src/server/sockets/chat.ts
import { socket } from '@briancray/belte/server/socket'

export const chat = socket<{ user: string; text: string }>({ history: 50 })
```

#### Publishing

`publish(message)` is isomorphic — server-side it notifies in-process iterators and fans out to remote subscribers over Bun's native `server.publish`; client-side (when `clientPublish` is set) it sends a frame the server validates.

```ts
chat.publish({ user: 'ada', text: 'hello' })
```

#### Consuming

A `Socket<T>` is itself an `AsyncIterable<T>`: iterating replays the full history buffer then tails live. `.tail(count)` replays only the last `count` (default `0`, clamped to `history`).

```ts
for await (const message of chat) {
    /* full history, then live */
}

for await (const message of chat.tail(10)) {
    /* last 10, then live */
}
```

On the client, layer `subscribe()` over it for a reactive latest value (see [Browser](#browser)).

## Clients

### Shared

`cache()` and `HttpError` (`@briancray/belte/shared/*`) behave identically on both sides.

**`cache(fn, options?)`** curries a call against a cache store. The outer call configures, the inner call invokes — checking the store for a prior entry (shared promise on hit, one invocation on miss). Works with a remote function, its `.raw` sibling, or any plain `Promise`-returning producer.

```ts
import { cache } from '@briancray/belte/shared/cache'

cache(getOrder)({ id })       // → Promise<Order>     (decoded body)
cache(getOrder.raw)({ id })   // → Promise<Response>  (raw escape hatch)
cache(fetchRates)()           // → Promise<Rates>     (plain producer)
```

| `options` field | Effect |
| --- | --- |
| `key` | Override the auto-derived key (method+url+args, or producer-ref+args). |
| `ttl` | Ms past resolve the entry lives: omitted = forever, `0` = dedupe only, `N` = expires after `N`. |
| `scope` | One or more tags grouping calls so `cache.invalidate({ scope })` drops them together. |
| `global` | Use the process-level store (server) so a value survives across requests. Client is one tab store — no-op. |
| `invalidate` | `{ throttle }` or `{ debounce }` ms — coalesce a burst of invalidations into a stale-while-revalidate refetch. |

`cache.invalidate(selector?)` drops matching entries (a remote fn, a producer, `{ key }`/`{ scope }`, or all); `cache.pending(selector?)` is a reactive in-flight probe for progress UI.

On the **server**, `cache()` is request-scoped by default (per-user data never leaks across requests) and its decoded value is serialized into the SSR HTML, then replayed on the client during hydration — no second fetch. How you consume the call decides inline vs streaming SSR:

```svelte
<script>
const order = await cache(getOrder)({ id }) // blocks render → baked into initial HTML
</script>

{#await cache(getOrder)({ id }) then order} <!-- pending flushes now, value streams in -->
    {order.total}
{/await}
```

### Browser

**Pages** — every folder under `src/browser/pages/` with a `page.svelte` mounts at that folder's URL. Dynamic segments use `[name]` and `[...rest]`.

| File | URL |
| --- | --- |
| `src/browser/pages/page.svelte` | `/` |
| `src/browser/pages/about/page.svelte` | `/about` |
| `src/browser/pages/orders/[id]/page.svelte` | `/orders/:id` |

Pages are Svelte 5 components; top-level `await` runs during SSR and hydrates:

```svelte
<script lang="ts">
import { cache } from '@briancray/belte/shared/cache'
import { getHello } from '$server/rpc/getHello.ts'

const hello = await cache(getHello)()
</script>

<h1>{hello.message}</h1>
```

**Layouts** — a `layout.svelte` wraps the pages below it. Layouts are nearest-only: the deepest matching one runs and replaces ancestors (they don't stack). Render `{@render children()}` to place the page. An `error.svelte` in a folder renders the nearest error boundary for a failed navigation, receiving `{ status, message, stack }`.

**`subscribe(subscribable)`** — reactive consumer for a `Socket` or `fn.stream(args)`. The first `$derived` read opens the underlying iterator; the last to stop closes it; many readers of the same source share one subscription. No-op on the server.

```svelte
<script lang="ts">
import { subscribe } from '@briancray/belte/browser/subscribe'
import { chat } from '$server/sockets/chat.ts'

const latest = $derived(subscribe(chat))
const status = $derived(subscribe.status(chat)) // 'pending' | 'open' | 'done' | 'error'
const error = $derived(subscribe.error(chat))
</script>
```

**`navigate(href, options?)`** — SPA navigation. Same-origin pushes history and swaps the view via a JSON resolve fetch; cross-origin or a failed resolve falls back to a hard navigation.

```ts
type navigate = (href: string, options?: { replace?: boolean; scroll?: boolean }) => Promise<void>
```

```ts
import { navigate } from '@briancray/belte/browser/navigate'
await navigate('/orders/7')
```

**Page state** (`@briancray/belte/browser/page`) — a `$state` object describing the current location. It's a discriminated union keyed on `route`, so narrowing `page.route` types `page.params`:

```svelte
<script lang="ts">
import { page } from '@briancray/belte/browser/page'
</script>

<p>route {page.route}, id {page.params.id}, {page.url.pathname}</p>
```

**`cache()` reactivity** — invalidation is implicit. A `cache()` read inside a `$derived`/`$effect` subscribes to its key; a `cache.invalidate(...)` re-runs that scope and fetches a fresh entry. `cache.pending(...)` re-runs when a matching call starts or settles.

### MCP

Generated automatically — there is no MCP server module to author. The endpoint lives at `POST /__belte/mcp` and inherits auth from the inbound request (bearer / cookie headers flow into each handler).

| MCP concept | Source |
| --- | --- |
| Tools | RPC verbs with `clients.mcp` (auto-on for read-only schema'd verbs; mutating verbs opt in) and sockets with `clients.mcp` (a `<name>-tail` read tool, plus `<name>-publish` when `clientPublish` is set). |
| Resources | Files under `src/mcp/resources/`, served as `belte://resources/<path>`. |
| Prompts | Markdown files under `src/mcp/prompts/`. |

A resource is any file you drop in:

```
src/mcp/resources/policies/refunds.md  →  belte://resources/policies/refunds.md
```

A prompt is markdown with optional YAML frontmatter; the body interpolates `{{name}}` placeholders from the declared `arguments`:

```markdown
---
description: Summarize an order for support
arguments:
  - name: orderId
    description: the order to summarize
    required: true
---
Summarize the status and line items of order {{orderId}} for a support agent.
```

### CLI

Generated automatically from the RPC registry. The standalone binary is a thin remote client — it carries no handler code but ships the compiled server beside it, so it can talk to a remote server or boot a local one.

| Env var | Meaning |
| --- | --- |
| `BELTE_APP_URL` | Default server URL — baked into a downloaded binary's `.env` from the host origin; shell-overridable. Public surface app code may read. |
| `BELTE_APP_TOKEN` | Sent as `Authorization: Bearer <value>`; baked when the download was authenticated. |

RPCs become commands; args/flags derive from each verb's schema. `/`-prefixed words manage the connection, a bare word runs a command:

| Invocation | Effect |
| --- | --- |
| `my-app` (TTY) | interactive session resuming the saved connection |
| `my-app getOrder --id 7` | one-shot RPC against the resumed target |
| `my-app getOrder --json '{"id":"7"}'` | full args bag as JSON (overrides flags); also accepts a JSON object on stdin |
| `my-app /connect <url>` | connect to a remote server, open a session |
| `my-app /start` | boot a local instance, open a session |
| `my-app /disconnect` | forget the saved connection |
| `my-app --help` / `my-app /help <cmd>` | top-level / per-command help |

**Downloading** — a running server hosts its own installer:

| Route | Serves |
| --- | --- |
| `GET /__belte/cli` | a shell install script (detects OS/arch, curls the right tarball into `~/.local/bin`) |
| `GET /__belte/cli/<platform>` | a gzipped tarball: the thin binary + sibling server + a `.env` with `BELTE_APP_URL` |

When the download request carries `Authorization: Bearer <token>`, that token is baked into the `.env` as `BELTE_APP_TOKEN`, so an authenticated download produces a pre-credentialed binary.

**Banner / footer** — `src/cli/banner.txt` prints atop the session and help; `src/cli/footer.txt` prints below help.

### Bundle

A movable, self-contained native desktop app for the host platform (a `.app` on macOS, a flat directory elsewhere). It boots into a connect screen and either starts its embedded server or connects to a remote one.

Configure the window from an optional `src/bundle/window.ts` default export:

```ts
type BundleWindow = {
    title?: string
    width?: number
    height?: number
    menu?: BundleMenu[]
    config?: StandardSchemaV1
}
```

| Field | Effect |
| --- | --- |
| `title` / `width` / `height` | Window chrome; default title is the program name. |
| `menu` | Custom top-level menus inserted between Edit and Window. |
| `config` | Overrides the first-run setup form schema (default: `src/server/config.ts`'s env schema). Its JSON Schema drives the connect screen's form; answers persist to the data-dir `.env`. |

```ts
// src/bundle/window.ts
import type { BundleWindow } from '@briancray/belte/bundle/BundleWindow'

export default {
    title: 'My App',
    width: 1024,
    height: 768,
} satisfies BundleWindow
```

**Menus** — a `BundleMenu` is `{ label, items }`; each `BundleMenuItem` is a separator, an `emit` item (dispatches a `belte:menu` event into the page), or a `navigate` item (repoints the window). Handle emits with `onMenu`:

```ts
import { onMenu } from '@briancray/belte/bundle/onMenu'

$effect(() => onMenu('reload', () => location.reload()))   // filtered
$effect(() => onMenu((name) => console.log(name)))         // catch-all
```

| Override file | Effect |
| --- | --- |
| `src/bundle/disconnected.svelte` | Replaces the built-in "server unreachable" screen. |
| `src/bundle/icon.icns` / `src/bundle/icon.png` | App icon (`.icns` used as-is, else `.png` converted). |
| `src/bundle/logo.png` | Logo on the connect/disconnected screens. |

## Some details

### Config, env, and data dir

Validate the process environment at boot with `env(schema)` from `@briancray/belte/server/env` — call it at module top level so a missing or malformed variable fails the boot loudly with every issue listed. The framework eager-imports `src/server/config.ts`:

```ts
// src/server/config.ts
import { env } from '@briancray/belte/server/env'
import { z } from 'zod'

export const config = env(z.object({ DATABASE_URL: z.string() }))
```

`appDataDir()` from `@briancray/belte/server/appDataDir` returns the running bundle's per-user data dir (macOS Application Support, Windows `%APPDATA%`, XDG elsewhere), keyed to the program name so an app's DB/cache lands beside belte's own config. `BELTE_DATA_DIR` overrides it on every platform.

### App hooks

An optional `src/app.ts` exports any of these (all optional, resolved at build time — no import needed):

| Export | Signature | Runs |
| --- | --- | --- |
| `init` | `({ server }) => void \| (() => void)` | once after `Bun.serve` boots; return a cleanup for SIGINT/SIGTERM |
| `handle` | `(request, next) => Response` | middleware wrapping the request pipeline |
| `handleError` | `(error, request) => Response` | custom 500 fallback |

### Project layout

```
src/
  app.ts                      # optional hooks
  server/
    config.ts                 # env(schema)
    rpc/<name>.ts             # one verb-bound remote function per file
    sockets/<name>.ts         # one socket per file
    lib/                      # your server-only helpers
  browser/
    app.html                  # optional SSR shell
    app.css
    pages/**/page.svelte      # routes (+ layout.svelte, error.svelte)
    public/                   # static files served from /
    lib/                      # your client-only helpers
  shared/
    lib/                      # your isomorphic helpers
  mcp/
    resources/**              # MCP resources
    prompts/**.md             # MCP prompts
  cli/
    banner.txt
    footer.txt
  bundle/
    window.ts
    disconnected.svelte
    icon.png
```

Mirror the framework's own split with a `lib/` folder under each surface (`server/lib`, `browser/lib`, `shared/lib`) for your own helpers. The scaffold maps `$server`, `$browser`, `$shared`, `$mcp`, `$cli` tsconfig aliases to these directories.

### CLI commands

| Command | Does |
| --- | --- |
| `bunx @briancray/belte scaffold <name>` | scaffold a new project |
| `belte dev` | build + run with `bun --watch` hot reload |
| `belte build` | build the client into `dist/_app/` |
| `belte start` | run the production server against `dist/` |
| `belte compile [--target] [--out]` | standalone server executable |
| `belte cli [--target] [--out] [--platforms=a,b,c]` | thin CLI binary + sibling server |
| `belte bundle` | movable self-contained app bundle for this platform (unsigned) |

### `public/` files

Files under `src/browser/public/` are served from the URL root (`src/browser/public/robots.txt` → `/robots.txt`). In a compiled binary they're embedded (zstd-compressed); in dev / `belte start` they're read from disk.

### Bundling

`belte compile` produces a single server executable with assets, public files, and MCP resources embedded. `belte cli` cross-compiles the thin client (+ server) per `--platforms` into `dist/cli-thin/<platform>/` — the layout the `/__belte/cli/<platform>` download endpoint streams. `belte bundle` assembles the desktop app; distribution to other users still needs platform signing/notarization.

### Logging and `DEBUG`

`log` from `@briancray/belte/shared/log` is the shared logger — a `[belte]` prefix, ANSI coloring, and a colored per-request line. `log.debug(scope, message)` only prints when the scope is enabled via the `DEBUG` env var, matching the `debug` npm package conventions:

| `DEBUG` value | Enables |
| --- | --- |
| `belte` | `belte` (request logging) |
| `belte:*` | `belte` and `belte:<anything>` |
| `*` | everything |
| `a,belte` | comma-separated list |
