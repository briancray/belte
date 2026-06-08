# belte

**Write one function. Get a web app, a CLI, and an AI tool — from the same line of code.**

belte is an HTTP framework for Bun + Svelte where a single declared function is
*simultaneously* an SSR call, a browser fetch, an MCP tool, a CLI subcommand, and
an OpenAPI operation. You don't wire up five surfaces. You write one handler; the
bundler swaps the runtime per target.

```ts
// src/server/rpc/getProduct.ts — the filename is the export, the URL, and the command name
import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'

export const getProduct = GET<{ id: string }>(async ({ id }) => json(await db.product(id)))
```

That one file is now all of this:

```text
                          src/server/rpc/getProduct.ts
                       export const getProduct = GET(...)
                                       │
      ┌───────────────┬───────────────┼───────────────┬────────────────┐
   browser           http            cli             mcp            openapi
   cache(getProduct) GET /rpc/        myapp           getProduct     GET op in
   ({ id })          getProduct?id=1  getProduct      tool, called   /openapi.json
   → SSR + hydrate   (decoded JSON)   --id 1          at /__belte/mcp
```

The swap is real, not a convention: inside `src/server/rpc/**` the bundler rewrites
`export const getProduct = GET(...)` to the server handler (`defineVerb`) for the
server build and to a network proxy (`remoteProxy`) for the browser build — same
callable, same name, same types. The MCP tool, CLI subcommand, and OpenAPI operation
are derived from the same registry at boot.

Don't take the diagram's word for it — belte prints the exact map at boot under
`DEBUG=belte`:

```sh
[belte] pages:
  page             layout  error
  /                ·       ·
  /products/[id]   /       ·
[belte] sockets:
  socket  schema  browser  mcp  cli  publish
  chat    ✓       ✓        ✓    ✓    ·
[belte] rpcs:
  http                    schema  browser  mcp  cli
  GET   /rpc/getHello     ·       ✓        ·    ·
  GET   /rpc/getProduct   ✓       ✓        ✓    ✓
  POST  /rpc/createOrder  ✓       ✓        ·    ✓
```

Each row is one declaration; each column is a surface. `✓` is present, `·` is
absent (a missing `schema` cell prints red, since the schema is what unlocks the
machine surfaces). Read a row to see one function's reach; scan a column to spot a
surface exposed — or not — by accident. `getHello` carries no schema, so it stays
browser-only. `getProduct` is a read with a schema, so MCP and CLI auto-expose.
`createOrder` mutates, so MCP stays off until you opt in — CLI still turns on.

## Why it's built this way

- **Zero runtime dependencies.** The package declares no `dependencies` — only
  optional Svelte/Tailwind peers. Everything else is Bun and Web platform APIs
  (`Bun.serve`, `Bun.CookieMap`, `Response`, `ReadableStream`, `EventTarget`,
  `structuredClone`).
- **No magic strings.** The export-to-runtime swap is a real source tokenizer
  (`findExportCallSite`) that skips strings, template literals, comments, regex, and
  nested generics — a `GET` mentioned in a docstring or `GET<Map<K, V>>(` is never
  mistaken for the call.
- **Safe by default for machines.** A mutating verb never auto-exposes to MCP. Reads
  (`GET`/`HEAD`) with a schema flip MCP on; `POST`/`PUT`/`PATCH`/`DELETE` require an
  explicit `clients: { mcp: true }`, so a model can't delete data just because the
  handler carries a schema.

## Scope — read this before you adopt

- **Bun-only, by design.** The runtime is `Bun.serve`, `Bun.CookieMap`, `Bun.file`,
  `Bun.Glob`, zstd, and Bun's bundler. There is no Node fallback. Requires Bun
  `>= 1.3.0`.
- **Svelte-only web surface.** Pages, layouts, and error boundaries are Svelte 5
  components. There is no other view layer.
- **Pre-1.0.** The API is small and stabilising, but still moving. The HTTP/SSR/RPC
  core is the mature centre; the MCP, CLI, and desktop-bundle surfaces are newer
  satellites built on the same registry.

## The mental model

Three ideas carry the whole framework.

1. **One runtime — dev equals build.** The same preload, the same `.svelte`
   compilation, the same `$server`/`$browser`/`$shared` resolution run under
   `belte dev`, `belte start`, and `belte compile`. There is no separate dev shim to
   drift from production.
2. **Declare once.** A file under `src/server/rpc/` exports exactly one verb-bound
   function; the filename is the export name and the URL. A file under
   `src/server/sockets/` exports one socket. The path is the identity.
3. **The namespace marks the side.** The import path tells you where a name runs and
   the bundler enforces it — so a server-only import can never reach the browser
   bundle.

| Namespace | Runs on | Examples |
| --- | --- | --- |
| `@belte/belte/server/*` | server only | `GET`, `socket`, `json`, `request`, `cookies`, `env`, `agent` |
| `@belte/belte/browser/*` | client only | `page`, `navigate`, `subscribe` |
| `@belte/belte/shared/*` | both (isomorphic) | `cache`, `HttpError`, `withJsonSchema`, `bundled` |

There is no umbrella `index.ts` and no barrel. Every public name has its own module
path (`@belte/belte/server/GET`, `@belte/belte/shared/cache`, …), so importing one
name never drags a side-effecting sibling into the bundle.

Project source uses five aliases mapped to the top-level directories: `$server`,
`$browser`, `$shared`, `$mcp`, `$cli`. (`lib/` is userland — declare your own alias.)

## One function, every surface

A single schema-bearing read, consumed five ways. The handler is written once:

```ts
// src/server/rpc/getProduct.ts
import * as v from 'valibot'
import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { error } from '@belte/belte/server/error'

export const getProduct = GET(
    async ({ id }) => {
        const product = await db.product(id)
        return product ? json(product) : error(404, 'no such product')
    },
    { inputSchema: v.object({ id: v.string() }) },
)
```

**Browser** — call it directly; it fetches. Or seed SSR HTML via `cache()`:

```svelte
<script lang="ts">
import { cache } from '@belte/belte/shared/cache'
import { getProduct } from '$server/rpc/getProduct.ts'

const product = await cache(getProduct)({ id: '42' })  // SSR-inlined, hydrated, no refetch
</script>
```

**HTTP** — a plain route, described by `/openapi.json`:

```sh
curl 'http://localhost:3000/rpc/getProduct?id=42'
```

**CLI** — a subcommand with a `--id` flag derived from the schema:

```sh
myapp getProduct --id 42
```

**MCP** — a tool named `getProduct` at `/__belte/mcp`, auto-exposed because the verb
is a read with a schema, annotated `readOnlyHint`.

**OpenAPI** — a `GET` operation with `id` as a required query parameter, `operationId`
`getProduct`.

## Server

### Server / rpc

#### Declaring

A verb helper binds an HTTP method to a handler. The bundler threads the method (from
the imported name) and the URL (from the file path under `src/server/rpc/`) in, so you
only write the handler.

```ts
type Verb = <Args, Return>(
    handler: (args: Args) => TypedResponse<Return> | Promise<TypedResponse<Return>>,
    opts?: {
        inputSchema?: StandardSchemaV1
        outputSchema?: StandardSchemaV1
        filesSchema?: StandardSchemaV1
        clients?: Partial<{ browser: boolean; mcp: boolean; cli: boolean }>
    },
) => RemoteFunction<Args, Return>
```

Helpers: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` (`@belte/belte/server/<VERB>`).

| Option | Effect |
| --- | --- |
| `inputSchema` | Any [Standard Schema](https://standardschema.dev) (zod, valibot, arktype). Validates inbound args; a failure replies `422`. `Args` infers from its output. Unlocks CLI for any verb, and MCP for reads. |
| `outputSchema` | Describes the success body for the OpenAPI `200` and the MCP tool `outputSchema`. |
| `filesSchema` | Validates the `File` parts of a multipart upload (kept out of `inputSchema` so its JSON-Schema projection never models a binary). |
| `clients` | Per-surface exposure override. `browser` defaults to `true`; `mcp`/`cli` default from the schema + method rule. Explicit values always win. |

`Args` comes from the handler parameter type (or the schema); `Return` is inferred
from the handler's return via the `TypedResponse<T>` brand on the response helpers, so
`GET(() => json({...}))` types end-to-end with no annotations.

Response helpers (one per file under `@belte/belte/server/`):

| Helper | Body | Defaults |
| --- | --- | --- |
| `json(data, init?)` | `Response.json` | `Cache-Control: no-store` |
| `error(status, message?, init?)` | `text/plain`; `message` falls back to the status reason phrase | `no-store`; positional `status` wins |
| `redirect(url, status?, init?)` | none; accepts relative URLs | `302`; `301/302/303/307/308` |
| `jsonl(iterable, init?)` | JSON Lines (`application/jsonl`), one value per line | `no-store`, `nosniff` |
| `sse(iterable, init?)` | Server-Sent Events (`text/event-stream`), 15s keepalive | `no-store`, `nosniff`, `keep-alive` |

Inside a handler, request-scoped helpers resolve against the in-flight request (each
throws if called outside a request scope):

| Call | Returns |
| --- | --- |
| `request()` | the inbound `Request` |
| `cookies()` | the request's `Bun.CookieMap`; `.set`/`.delete` flush as `Set-Cookie` on the way out |
| `server()` | the active `Bun.Server` (a no-op stand-in for in-process CLI/MCP/test dispatch) |

> SSR renders and MCP tool calls invoke handlers in-process. Only an allowlist of
> inbound headers is forwarded onto those synthesized requests (`cookie`,
> `authorization`, the `x-forwarded-*` hints). Extend it with `forwardHeaders` in
> `src/app.ts` for headers a handler reads (e.g. `accept-language`, `x-tenant-id`).

Multipart uploads: a body verb (`POST`/`PUT`/`PATCH`) accepts a `FormData` in place of
typed args. Text fields validate against `inputSchema`; `File` parts validate against
`filesSchema` and merge into the handler's args bag.

`env()` validates the process environment at module top level so a bad config fails the
boot loudly. `withJsonSchema()` attaches a `toJSONSchema()` projection to a schema
whose library lacks one (Zod 4 / Effect / Arktype already carry theirs).

```ts
// src/server/config.ts
import * as v from 'valibot'
import { env } from '@belte/belte/server/env'
import { withJsonSchema } from '@belte/belte/shared/withJsonSchema'
import { toJsonSchema } from '@valibot/to-json-schema'

export const config = env(
    withJsonSchema(
        v.object({ DATABASE_URL: v.string(), STRIPE_KEY: v.string() }),
        (schema) => toJsonSchema(schema),
    ),
)
```

#### Consuming

A declared verb is a `RemoteFunction` — the same callable on both sides.

| Form | Resolves to |
| --- | --- |
| `fn(args)` | the Content-Type-decoded body (`Promise<Return>`); throws `HttpError` on non-2xx |
| `fn.raw(args)` | the underlying `Response` (status / headers / streaming) |
| `fn.stream(args)` | a `Subscribable<Return>` view of the body — SSE/JSONL frames, or the decoded body once |

```ts
import { HttpError } from '@belte/belte/shared/HttpError'

try {
    const product = await getProduct({ id: '42' })
} catch (err) {
    if (err instanceof HttpError && err.status === 404) {
        // err.response carries the raw Response (body, headers, status)
    }
}
```

`HttpError` carries `status`, `statusText`, and the raw `response`. The full HTTP
description of every verb is served at `/openapi.json` (OpenAPI 3.1; also `/swagger.json`).

### Server / sockets

A socket is a bidirectional named broadcast primitive, declared once under
`src/server/sockets/`; the import resolves to a server-side fan-out or a client-side
WebSocket proxy by build target. All sockets multiplex onto one framework-owned
connection per client at `/__belte/sockets`.

#### Declaring

```ts
type socket = <T>(opts?: {
    history?: number          // replay buffer size (default 0)
    ttl?: number              // ms; history entries older than this are evicted lazily on read
    clientPublish?: boolean   // accept publishes from clients (default false — server-only topic)
    schema?: StandardSchemaV1 // validates payloads on publish; unlocks mcp/cli
    clients?: Partial<{ browser: boolean; mcp: boolean; cli: boolean }>
}) => Socket<T>
```

```ts
// src/server/sockets/chat.ts
import { socket } from '@belte/belte/server/socket'

export const chat = socket<{ user: string; text: string }>({ history: 50 })
```

#### Publishing

`publish` is isomorphic. Server code fans out in-process *and* to remote subscribers;
client code (via the proxy) sends a `pub` frame the dispatcher validates against the
socket's `clientPublish` flag.

```ts
chat.publish({ user: 'ada', text: 'hello' })
```

#### Consuming

A `Socket<T>` is an `AsyncIterable<T>`. Iterating replays the full history buffer then
tails live; `.tail(count)` replays only the last `count` (clamped to the history max)
first.

```ts
for await (const message of chat) {
    // history replay, then live
}

for await (const message of chat.tail(10)) {
    // last 10, then live
}
```

For a reactive view in a component, pass the socket to `subscribe()` (below).

## Clients

### Shared

`cache()` curries a remote function (or a plain async producer) against a per-request
(server) or per-tab (client) store, dedupes concurrent calls, and drives SSR
inlining + hydration.

```ts
type cache = <Args, Return>(
    fn: RemoteFunction<Args, Return> | ((args?: Args) => Promise<Return>),
    options?: {
        ttl?: number                              // undefined = forever; 0 = dedupe only; >0 = expire ms after resolve
        global?: boolean                          // process-level store (memoise an external endpoint) vs request-scoped
        scope?: string | string[]                 // tag for cache.invalidate({ scope })
        invalidate?: { throttle?: number; debounce?: number }  // stale-while-revalidate policy
    },
) => (args?: Args) => Promise<Return> | Return
```

```ts
const post = await cache(getPost)({ id })          // server: SSR-inlined; client: dedup + reactive
const rates = await cache(fetchRates, { global: true })()   // memoise across requests
```

How you consume the call decides SSR mode, per Svelte's `{#await}` rule:

```svelte
{#await cache(getPost)({ id }) then post}   <!-- shell flushes now; value streams in -->
    {post.title}
{/await}

<script lang="ts">
const post = await cache(getPost)({ id })   <!-- blocks render; baked into initial HTML -->
</script>
```

For a warm (already-hydrated) key, the decoded read returns synchronously — its type is
`Promise<Return> | Return`. Consume it with `await` / `{#await}`; in the `await` form,
handle errors with `try`/`catch`, not `.catch`.

Cache keys are canonicalised so they distinguish types `JSON.stringify` would flatten:
`Date`, `Map`, `Set`, and `bigint` each key distinctly (a `Date` never collides with
its ISO string), and object/Map/Set key order doesn't change the key.

Reactivity is implicit: a read inside a `$derived`/`$effect` subscribes that scope;
`cache.invalidate(selector?)` re-runs it. `cache.pending(selector?)` and
`cache.refreshing(selector?)` are reactive in-flight / revalidating probes. A selector
is a remote function, a producer, `{ scope }`, or omitted (everything).

`HttpError` (above) is shared — thrown on both sides on non-2xx.

### Browser

| Surface | Path | Notes |
| --- | --- | --- |
| Pages | `src/browser/pages/**/page.svelte` | Svelte 5; mounts at the folder URL; `[id]` segments are typed params |
| Layouts | `src/browser/pages/**/layout.svelte` | nearest-wins (one layout per page, the closest ancestor) |
| Error pages | `src/browser/pages/**/error.svelte` | nearest-wins error boundary |
| Document shell | `src/browser/app.html` | the HTML envelope |
| Static assets | `src/browser/public/**` | served at `/` (zstd-embedded into a compiled binary) |

`page` is reactive route state — read it in a `$derived` and it re-runs on navigation:

| Field | Type |
| --- | --- |
| `page.route` | the matched route key (discriminates `params`) |
| `page.params` | the route's typed params |
| `page.url` | the live `URL` of the current location |

```ts
type navigate = (href: string, options?: { replace?: boolean; scroll?: boolean }) => Promise<void>
```

`navigate()` is SPA navigation: a same-pathname change (search/hash only) skips the
network and just reassigns `page.url`; a cross-route target resolves the view before
touching history, falling back to a hard navigation for non-SPA targets.

`subscribe()` is the reactive consumer for streaming sources — both a `Socket<T>` and
`fn.stream(args)` satisfy its `Subscribable<T>` input. The first read in a tracking
scope opens the iterator; the last to stop reading closes it (built on
`createSubscriber`, like `cache`).

```svelte
<script lang="ts">
import { subscribe } from '@belte/belte/browser/subscribe'
import { chat } from '$server/sockets/chat.ts'

const latest = $derived(subscribe(chat))               // T | undefined
const error = $derived(subscribe.error(chat))          // Error | undefined
const status = $derived(subscribe.status(chat))        // 'pending' | 'open' | 'done' | 'error'
</script>
```

`subscribe()` is a no-op on the server (SSR can't hold a stream open). Seed initial HTML
with `cache()` against an HTTP rpc, then layer `subscribe()` on top for live updates.

### Mcp

The MCP server is generated at `/__belte/mcp` (JSON-RPC over HTTP POST). There is no
module to author — the surface is derived from the registry:

- **Tools** come from every verb with `clients.mcp: true` (auto-on for read-only verbs
  with a schema) and every mcp-exposed socket (a `<name>-tail` read tool, plus a
  `<name>-publish` tool when `clientPublish` is set). The HTTP method feeds each tool's
  `readOnlyHint` / `destructiveHint` / `idempotentHint` annotations.
- **Resources** are files under `src/mcp/resources/**`, served under `belte://resources/`
  URIs (text inline, binary as base64).
- **Prompts** are markdown files under `src/mcp/prompts/**`; frontmatter `arguments`
  become the prompt's typed arguments, interpolated into the body on `prompts/get`.

Tool calls forward the inbound request's auth headers into the handler, so a model acts
with the caller's identity. The same surface backs the in-app `agent()` helper
(`@belte/belte/server/agent`), which runs a provider engine against the gated tool set
and streams `AgentFrame`s the handler wraps in `jsonl()` or `sse()`.

### Cli

`belte cli` builds a standalone CLI binary — a thin remote client with the rpc manifest
baked in, shipping the compiled server beside it so it can boot a local instance. Every
verb with `clients.cli: true` becomes a subcommand; flags are derived from its schema.

| First token | Action |
| --- | --- |
| `<cmd> [--flags]` | one-shot RPC against the resumed target |
| (none) on a TTY | interactive session resuming the saved connection |
| `/connect <url>` | connect to a remote server, open a session |
| `/start` | boot a local instance, open a session |
| `/disconnect` | forget the saved connection |
| `/help [cmd]`, `--help` | help |

Flag parsing follows the schema: `boolean` → `--name` / `--no-name`; `number`/`integer`
→ `--name <n>`; `array` → repeated `--name <v>`; anything else → `--name <value>`.
`--json '<args>'` supplies the whole args bag; a piped JSON object on stdin seeds it.

The connection target comes from `BELTE_APP_URL` / `BELTE_APP_TOKEN` (shell > data-dir
> binary-dir), so a fresh download resumes against a baked default. Session chrome reads
`src/cli/banner.txt` and `src/cli/footer.txt`. Authenticated builds are downloadable
from a running server at `/__belte/cli`.

### Bundle

`belte bundle` assembles a movable, self-contained desktop app for the host platform
(a `.app` on macOS, a flat directory elsewhere) — the server binary, the launcher, and
the native webview lib together. The bundle is **unsigned**; distributing it to other
users still needs platform signing/notarization (macOS Gatekeeper will block an
unsigned `.app`).

The app boots into a connect screen: start the embedded server or connect to a remote
one. Configure the window from an optional `src/bundle/window.ts`:

```ts
import type { BundleWindow } from '@belte/belte/bundle/BundleWindow'

export default {
    title: 'My App',
    width: 1100,
    height: 720,
} satisfies BundleWindow
```

| Field | Effect |
| --- | --- |
| `title` / `width` / `height` | window chrome (default: program name + webview defaults) |
| `menu` | custom top-level menus; items emit `belte:menu` events |
| `config` | overrides the first-run setup form's schema (default: `src/server/config.ts`'s env schema) |

`onMenu(name?, handler)` (`@belte/belte/bundle/onMenu`) subscribes to custom menu
clicks and returns an unsubscribe, dropping straight into a Svelte `$effect`. The
setup form is derived from the env schema, so one declaration drives both boot
validation and the connect screen's first-run form; answers persist to the data-dir
`.env`. `src/bundle/icon.png` is the app icon; a `disconnected` screen renders when the
remote drops.

## Some details

`appDataDir()` (`@belte/belte/server/appDataDir`) returns the running app's per-user
data directory, keyed by program name so the app's DB/cache land beside belte's own
config. `bundled()` (`@belte/belte/shared/bundled`) is true inside the desktop bundle
(isomorphic — one name, both sides).

Application hooks live in `src/app.ts` (all optional, resolved at build time — no import
from your code):

| Hook | Signature | Role |
| --- | --- | --- |
| `forwardHeaders` | `string[]` | extra inbound headers to forward onto in-process rpc requests |
| `init` | `(ctx: { server }) => void \| cleanup \| Promise<…>` | one-time setup after `Bun.serve`; cleanup runs on SIGINT/SIGTERM |
| `handle` | `(request, next) => Response` | single middleware wrapping the request pipeline |
| `handleError` | `(error, request) => Response` | custom 500 fallback |

Project layout (scaffolded by `bunx belte scaffold <name>`):

```text
src/
  app.ts                       optional hooks
  server/
    config.ts                  env() schema (boot validation + bundle setup form)
    rpc/<name>.ts              one verb each → /rpc/<name>
    sockets/<name>.ts          one socket each
  mcp/
    prompts/<name>.md          MCP prompts
    resources/**               MCP resources (belte:// URIs)
  browser/
    pages/**/page.svelte       routed pages
    pages/**/layout.svelte     nearest-wins layouts
    pages/**/error.svelte      nearest-wins error boundaries
    public/**                  static assets served at /
    app.html                   document shell
    app.css                    global styles
  cli/
    banner.txt / footer.txt    CLI session chrome
  bundle/
    window.ts                  BundleWindow config
    icon.png                   app icon
  lib/                         userland shared code (your own alias)
```

CLI commands (`belte <command>`):

| Command | Action |
| --- | --- |
| `scaffold <name>` | scaffold a new project (`bunx belte scaffold <name>`) |
| `dev` | build + run with hot reload |
| `build` | build the client into `dist/_app/` |
| `start` | run the production server against `dist/` |
| `run <file> [args]` | run a script under the belte preload (same runtime as the server) |
| `compile [--target] [--out]` | build a standalone server executable |
| `cli [--target] [--out] [--platforms]` | build the CLI binary |
| `bundle` | build the movable desktop app bundle |

For tests, add `preload = ["@belte/belte/preload"]` under `[test]` in `bunfig.toml` and
use `bun test`.

Cross-compile targets (`--target` / `--platforms`):

| Target |
| --- |
| `bun-darwin-arm64` |
| `bun-darwin-x64` |
| `bun-linux-arm64` |
| `bun-linux-x64` |
| `bun-windows-x64` |

Environment variables:

| Variable | Effect |
| --- | --- |
| `PORT` | listen port (default `3000`; scans upward when busy) |
| `DEBUG` | `debug`-style scopes; `DEBUG=belte` prints the boot surface map |
| `BELTE_APP_URL` / `BELTE_APP_TOKEN` | the CLI binary's default connection target |
| `BELTE_IDLE_TIMEOUT` | per-connection idle timeout |
| `BELTE_DATA_DIR` | override the per-user data directory |

Logging is the shared `[belte]`-prefixed logger; `DEBUG` gates scoped debug output and,
at `DEBUG=belte`, the three-table surface map at boot.
</content>
