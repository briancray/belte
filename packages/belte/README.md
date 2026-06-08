# belte

**Write one function. Get a web app, a CLI, and an AI tool — from the same line of code.**

belte is an HTTP framework for Bun + Svelte where a single declared function is
*simultaneously* an SSR call, a browser fetch, an MCP tool, a CLI subcommand, and
an OpenAPI operation. You don't wire up five surfaces. You write one handler; the
bundler swaps the runtime per target.

```ts
// src/server/rpc/getPost.ts — the filename is the export, the URL, and the command name
import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'

export const getPost = GET<Post, typeof schema>(
    async ({ id }) => json(await db.post(id)),
    { inputSchema: schema },
)
```

That one file is now all of this:

```text
                 src/server/rpc/getPost.ts
                            │
   ┌────────────┬──────────┼───────────┬──────────────────┐
 browser       http        cli         mcp            openapi
 cache(getPost) GET         myapp        getPost        GET /rpc/getPost
   ({ id })     /rpc/        getPost      tool           operation in
                getPost?     --id 1       (read-only)    /openapi.json
                id=1
```

Don't take the diagram's word for it — with `DEBUG=belte`, belte prints the exact
map at boot:

```sh
pages:
  page         layout  error
  /            ·       ·
  /posts/[id]  ·       ·
sockets:
  socket  schema  browser  mcp  cli  publish
  chat    ✓       ✓        ✓    ✓    ✓
rpcs:
  http                   schema  browser  mcp  cli
  GET   /rpc/getPost     ✓       ✓        ✓    ✓
  POST  /rpc/createPost  ✓       ✓        ✓    ✓
```

The `schema` column is the gate: a verb or socket with no schema reddens its `·`
there, because that is what holds its `mcp`/`cli` columns off. Every surface a
function reaches is auditable in one place — no surface is ever exposed by accident.

## Why it's built this way

- **Zero runtime dependencies.** belte ships no `dependencies` — only optional
  peers (`svelte`, and `bun-plugin-tailwind` / `tailwindcss` for styling). The
  runtime is Bun (`Bun.serve`, `Bun.CookieMap`, `Bun.YAML`, `Bun.zstdDecompress`,
  `Bun.file`) and Web standards (`Request`/`Response`, `ReadableStream`,
  `AsyncIterable`, `structuredClone`).
- **No magic strings.** The bundler finds each `export const x = GET(fn)` with a
  character-level scanner that skips strings, templates, comments, regexes, and
  TypeScript generics (`findExportCallSite.ts`) — a `GET` inside a docstring or a
  `GET<Map<K, V>>(` is never mistaken for the call site.
- **Safe by default for machines.** A schema-bearing read verb (`GET`/`HEAD`)
  auto-exposes to MCP; a mutating verb (`POST`/`PUT`/`PATCH`/`DELETE`) never does
  just because it carries a schema — it requires an explicit `clients: { mcp: true }`
  (`defineVerb.ts`, `resolveClientFlags.ts`, `isReadOnlyMethod.ts`).

## Scope — read this before you adopt

- **Bun-only, by design.** belte targets `bun >= 1.3.0` and builds on Bun APIs with
  no Node fallback path.
- **Svelte-only web surface.** Pages, layouts, and error pages are Svelte 5
  components; there is no other view layer.
- **Pre-1.0.** The core (rpc, sockets, cache, SSR+SPA) is the mature surface; the
  satellites (`mcp`, `cli`, `bundle`/desktop, `agent`) are newer. Expect change.
- **No umbrella import.** There is no `.` barrel — every public name has its own
  path (`@belte/belte/server/GET`, `@belte/belte/shared/cache`, …), so importing one
  name never drags in side-effecting siblings.

---

## The mental model

Three ideas carry the whole framework.

1. **One runtime.** Dev and build run the same code through the same plugins; the
   only thing that changes per target is which runtime the bundler swaps in behind a
   declared name.
2. **Declare once.** A file under `src/server/rpc/` exports exactly one verb; its
   filename is the export name, its path is the URL, and its schema decides which
   surfaces it reaches. Same for `src/server/sockets/`.
3. **The namespace marks the side.** The first path segment tells you where a name
   runs.

| namespace | runs on | examples |
| --- | --- | --- |
| `server/*` | server only | `server/GET`, `server/socket`, `server/json`, `server/request`, `server/cookies`, `server/env`, `server/agent` |
| `browser/*` | client only | `browser/page`, `browser/navigate`, `browser/subscribe` |
| `shared/*` | isomorphic — same callable, same behaviour both sides | `shared/cache`, `shared/HttpError`, `shared/withJsonSchema`, `shared/bundled` |
| `bundle/*` | desktop bundle | `bundle/BundleWindow`, `bundle/onMenu`, `bundle/BundleMenu` |

No `index.ts` barrels anywhere. Each import is its own module path.

## One function, every surface

A single schema-bearing verb, consumed five ways. Declare it once:

```ts
// src/server/rpc/getPost.ts
import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { z } from 'zod'

const schema = z.object({ id: z.string() })

export const getPost = GET<Post, typeof schema>(
    async ({ id }) => json(await db.post(id)),
    { inputSchema: schema },
)
```

Now consume it.

```ts
// browser / SSR — same callable, bundler-swapped runtime
const post = await cache(getPost)({ id })
```

```sh
# http — args on the query string for a GET
curl 'http://localhost:3000/rpc/getPost?id=42'
```

```sh
# cli — the thin client turns it into a subcommand with schema-derived flags
myapp getPost --id 42
```

```json
// mcp — POST /__belte/mcp, tools/call
{ "method": "tools/call", "params": { "name": "getPost", "arguments": { "id": "42" } } }
```

```sh
# openapi — the operation is in the generated document
curl http://localhost:3000/openapi.json
```

`getPost` is read-only and carries a schema, so all five light up automatically. A
mutating verb would expose `http`, `openapi`, and `browser` by the same rules, but
hold `mcp` off until you opt in.

---

## Server

### Server / rpc

#### Declaring

A verb helper rewrites `export const x = VERB(fn, opts?)` into a server handler (or
a browser fetch stub). One export per file.

```ts
type VerbHelper = <Return, InputSchema, FilesSchema>(
    fn: (args: InferOutput<InputSchema>) => Response | Promise<Response>,
    opts?: {
        inputSchema?: InputSchema
        outputSchema?: StandardSchemaV1
        filesSchema?: FilesSchema
        clients?: Partial<{ browser: boolean; mcp: boolean; cli: boolean }>
    },
) => RemoteFunction<InferInput<InputSchema>, Return>
```

| option | type | effect |
| --- | --- | --- |
| `inputSchema` | Standard Schema | validates args (422 on failure); projected to OpenAPI / MCP / CLI. Its presence flips on `cli`, and `mcp` for read-only verbs |
| `outputSchema` | Standard Schema | describes the 200 body in the OpenAPI doc and the MCP tool `outputSchema` |
| `filesSchema` | Standard Schema | validates multipart `File` parts; kept off the JSON-Schema projection (a `File` has no honest conversion) |
| `clients` | partial flags | explicit per-surface override; always wins over the computed defaults |

Helpers: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`. Any Standard Schema
library (zod, valibot, arktype) works without an adapter.

```ts
// a mutation must opt into MCP explicitly
export const createPost = POST<Post, typeof schema>(
    async (input) => json(await db.create(input), { status: 201 }),
    { inputSchema: schema, clients: { mcp: true } },
)
```

**Response helpers** — each returns a `TypedResponse<T>` whose phantom `T` lets the
caller-facing return type infer from the handler body.

| helper | path | builds |
| --- | --- | --- |
| `json(data, init?)` | `server/json` | `application/json`, `Cache-Control: no-store` by default |
| `jsonl(iterable, init?)` | `server/jsonl` | JSON Lines stream (`application/jsonl`), one value per line |
| `sse(iterable, init?)` | `server/sse` | Server-Sent Events stream with a 15s keepalive comment |
| `error(status, message?, init?)` | `server/error` | `text/plain` error; message defaults to the standard reason phrase |
| `redirect(url, status?, init?)` | `server/redirect` | 301/302/303/307/308; accepts relative URLs (default 302) |

`jsonl` and `sse` carry generator errors as a final frame (`{"$error": "…"}` /
`event: error`) with only the message on the wire — the full error is logged
server-side. Cancellation flows from the consumer into the generator's `for await`
via `iter.return()`.

**Request-scoped helpers** — resolve only while an SSR render or rpc handler is in
flight (they throw outside a request scope):

- `request()` (`server/request`) — the inbound `Request`.
- `server()` (`server/server`) — the active `Bun.serve` instance (a no-op stand-in
  under in-process CLI / MCP / test dispatch).
- `cookies()` (`server/cookies`) — Bun's `CookieMap`: a live `Map<string, string>`
  plus `.set(name, value, options)` and `.delete(name)`, flushed to `Set-Cookie` on
  return.

> SSR and MCP call verbs **in-process**, and that path forwards only an allowlist of
> inbound headers — `cookie`, `authorization`, and the `x-forwarded-*` hints. A
> handler that reads any other header (e.g. `accept-language`, `x-tenant-id`) during
> SSR or an MCP call sees nothing unless you extend the list via the `forwardHeaders`
> export in `src/app.ts`.

**Multipart uploads** — a body verb with `filesSchema` receives the validated text
fields merged with the `File` parts; call it with a `FormData`:

```ts
export const upload = POST(
    async ({ title, file }) => json(await store(title, file)),
    { inputSchema: z.object({ title: z.string() }), filesSchema: z.object({ file: z.instanceof(File) }) },
)
```

**Schemas without `toJSONSchema()`** — wrap once at the declaration so the OpenAPI
doc, MCP tools, and CLI flags can read it:

```ts
import { withJsonSchema } from '@belte/belte/shared/withJsonSchema'
const schema = withJsonSchema(valibotSchema, (s) => toJsonSchema(s))
```

#### Consuming

A `RemoteFunction` is one callable with two siblings:

| form | resolves to | use |
| --- | --- | --- |
| `fn(args)` | decoded body (`Promise<Return>`); throws `HttpError` on non-2xx | the default call |
| `fn.raw(args)` | the underlying `Response` | status / headers / manual streaming |
| `fn.stream(args)` | a `Subscribable<Return>` | frame-by-frame consumption via `subscribe()` |

```ts
import { HttpError } from '@belte/belte/shared/HttpError'

try {
    const post = await getPost({ id })
} catch (err) {
    if (err instanceof HttpError && err.status === 404) {
        // err.response is the raw Response
    }
}
```

The HTTP surface is always on, independent of the other clients. The OpenAPI 3.1
document for every verb is served at `/openapi.json`.

### Server / sockets

A WebSocket-backed pub/sub topic. Every socket multiplexes onto one
framework-owned connection per client at `/__belte/sockets` — user code never
touches the raw ws lifecycle.

#### Declaring

```ts
type SocketOptions = {
    history?: number        // messages replayed to a new subscriber
    ttl?: number            // ms; history entries past it are evicted lazily on read
    clientPublish?: boolean // allow clients to publish (off by default)
    schema?: StandardSchemaV1 // validates publishes; unlocks mcp/cli
    clients?: Partial<{ browser: boolean; mcp: boolean; cli: boolean }>
}
```

```ts
// src/server/sockets/chat.ts
import { socket } from '@belte/belte/server/socket'
import { z } from 'zod'

export const chat = socket({
    schema: z.object({ user: z.string(), text: z.string() }),
    history: 50,
    clientPublish: true,
})
```

With a schema, `T` infers from it and publishes validate on the server.
Schemaless → browser-only; schema present → all surfaces.

#### Publishing

```ts
chat.publish({ user, text }) // server-side: notifies in-process iterators + broadcasts to ws clients
```

`publish` is isomorphic — called from the client (via the socket proxy) it sends a
`pub` frame the server validates and forwards.

#### Consuming

A `Socket<T>` is an `AsyncIterable`: a bare `for await` replays the full history
buffer then tails live; `.tail(count)` replays the last `count` items (default `0`).

```ts
for await (const message of chat) {
    // history first, then live
}

const recent = chat.tail(10)
```

In a Svelte component, layer `subscribe()` on top for reactivity (below).

### Server / agent

`agent(engine, messages)` runs a model engine against the app's own MCP surface
(its gated tools/prompts/resources) and returns the engine's frame stream. The
handler picks the transport — same as any streaming verb.

```ts
// src/server/rpc/chat.ts
import { agent } from '@belte/belte/server/agent'
import { jsonl } from '@belte/belte/server/jsonl'
import { engine } from '@belte/anthropic'

const chatEngine = engine({ model: 'claude-opus-4-8', apiKey: config.ANTHROPIC_API_KEY })

export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), { inputSchema })
```

The engine (a `@belte/<provider>` package) only sees the surface in and yields
frames out, so swapping providers never touches the verb or the UI. Permission is
decided server-side: the surface is already gated by each verb's `clients.mcp` plus
its own handler auth.

---

## Clients

### Shared

`cache(fn, options?)` (`shared/cache`) returns an invoker; calling it dedupes
against a store — a shared promise on hit, one invocation on miss. `fn` is a verb
helper, its `.raw`, or a plain producer returning a `Promise`.

```ts
type CacheOptions = {
    ttl?: number                 // ms past resolve; omitted = forever, 0 = dedupe-only
    scope?: string | string[]    // tags for grouped cache.invalidate({ scope })
    global?: boolean             // process-level store instead of per-request
    invalidate?: { throttle?: number } | { debounce?: number } // coalesce invalidations (stale-while-revalidate)
}
```

```ts
// server (request-scoped store by default — per-user data never leaks across requests)
const post = await cache(getPost)({ id })

// browser (one tab store)
const post = $derived(await cache(getPost)({ id }))
```

`cache.invalidate(selector?)`, `cache.pending(selector?)`, and
`cache.refreshing(selector?)` share one selector grammar: no arg = everything, a
function = that function's calls, `{ scope }` = a tagged group.

**SSR mode is decided by how you read**, per Svelte's `{#await}` rule:

```svelte
<!-- top-level await → blocks render → value baked into the initial HTML -->
<script>const post = await cache(getPost)({ id })</script>

<!-- {#await} → shell flushes now, value streams in on the same response -->
{#await cache(getPost)({ id }) then post}…{/await}
```

There is no `ssr` option — the consumption form is the switch. (A top-level await
flips Svelte's whole component instance into await-everything mode, so isolate
blocking and streaming reads in separate components.)

Cache keys are derived with `canonicalJson.ts`, which tags types so they never
collide: a `Date` never equals the string of its ISO form, a `Map` never equals a
plain object, and `Set`/`bigint`/`-0` each key distinctly.

`HttpError` (`shared/HttpError`) carries `status`, `statusText`, and the raw
`response` for error UI without opting into `.raw`.

### Browser

- **Pages** are folder-based Svelte 5 components: `src/browser/pages/**/page.svelte`,
  the URL is the directory path. `[name]` is a dynamic param, `[...rest]` a
  catch-all; params arrive as `$props`.
- **Layouts** are `layout.svelte` files; the nearest ancestor wraps a page
  (nearest-only, not nested chains).
- **Error pages** are `error.svelte` files (nearest-only); they render on the server
  for an unknown route (404) or a throw during render, receiving `{ status, message }`.

```ts
// shared/cache reactivity is implicit — createSubscriber drives the lifecycle
const post = $derived(await cache(getPost)({ id }))
```

**`subscribe(subscribable)`** (`browser/subscribe`) reactively reads a streaming
source — a `Socket<T>` or `fn.stream(args)`. The first `$derived` read opens the
underlying iterator; the last to stop reading closes it; readers of the same key
share one subscription.

```svelte
<script>
import { subscribe } from '@belte/belte/browser/subscribe'
const latest = $derived(subscribe(chat))                       // socket
const tick = $derived(subscribe(tickFeed.stream({ to: 5 })))   // rpc stream
const err = $derived(subscribe.error(chat))                    // surfaced, never thrown
const status = $derived(subscribe.status(chat))                // 'pending' | 'open' | 'done' | 'error'
</script>
```

`subscribe` is a no-op during SSR — seed initial HTML with `cache()` against an
HTTP verb, then layer `subscribe()` for live updates after hydration.

**`navigate(href, options?)`** (`browser/navigate`) does SPA navigation:

```ts
type NavigateOptions = { replace?: boolean; scroll?: boolean }
await navigate('/posts/42')
```

A same-pathname change skips the network round-trip and just reassigns `page.url`;
a non-SPA target hard-navigates cleanly.

**`page`** (`browser/page`) is reactive `$state`. Narrowing on `page.route` narrows
`page.params` to the matching shape.

| field | type | meaning |
| --- | --- | --- |
| `page.route` | route key | the matched route (e.g. `/posts/[id]`) |
| `page.params` | params for the route | path params, typed per route |
| `page.url` | `URL` | live location; reassigned on every navigation |

### Mcp

The MCP server is generated at `/__belte/mcp` (JSON-RPC over HTTP, protocol
`2025-06-18`) — there is no module to author.

- **Tools** come from every verb with `clients.mcp: true` (read-only + schema
  auto-on; mutations opt in) and every mcp-exposed socket (a `<base>-tail` read tool,
  plus `<base>-publish` when `clientPublish` is set). The HTTP verb feeds each tool's
  `readOnlyHint` / `destructiveHint` / `idempotentHint` annotations. Auth inherits
  from the inbound request.
- **Resources** are files under `src/mcp/resources/`, served at
  `belte://resources/<path>` (text inline, binary as base64). No module to author.
- **Prompts** are `src/mcp/prompts/**.md` files: optional YAML frontmatter
  (`description`, `arguments`) plus a body interpolated via `{{name}}` placeholders.

```md
---
description: Summarise a thread
arguments:
  - name: topic
    required: true
---
Summarise the discussion about {{topic}}.
```

### Cli

`belte cli` builds a thin remote client — it carries no handler code, talks to a
running server over HTTP, and ships the compiled server beside it so it can spawn a
local instance.

- Connection state comes from `BELTE_APP_URL` / `BELTE_APP_TOKEN` (shell env >
  data-dir `.env` > binary-dir `.env`). A downloaded binary resumes against its
  baked default.
- The first positional decides the action: `/`-prefixed verbs manage the connection,
  a bare word runs an rpc.

| command | does |
| --- | --- |
| `<cmd> [--flags]` | one-shot rpc against the resumed target |
| `/connect <url>` | connect to a remote server, open a session |
| `/start` | boot a local instance, open a session |
| `/disconnect` | forget the saved connection |
| `/help [cmd]` | help, per-command with an arg |
| *(none)* on a TTY | interactive session resuming the saved connection |

Schema-bearing rpcs become subcommands; the JSON Schema types the flags:

| property type | flag form |
| --- | --- |
| `boolean` | `--name` / `--no-name` |
| `number` / `integer` | `--name <n>` (coerced) |
| `array` | repeated `--name <v>` |
| anything else | `--name <value>` (string) |
| complex shapes | `--json '<args>'`, or pipe a JSON object on stdin |

A running server hands out the client: `GET /__belte/cli` returns a POSIX install
script (detects OS+arch, downloads the right tarball); `GET /__belte/cli/<platform>`
streams a gzipped tarball of the platform binary, its sibling server, and a `.env`
carrying `BELTE_APP_URL` (and `BELTE_APP_TOKEN` if the request was authenticated).
`src/cli/banner.txt` and `src/cli/footer.txt` wrap the help output.

### Bundle

`belte bundle` assembles a movable, self-contained desktop app for the host
platform (a `.app` on macOS, a flat directory elsewhere) — the server binary, the
launcher, and the native webview lib together. It boots into a connect screen that
can **start the embedded server** or **connect to a remote one**.

> Bundles are **unsigned** — distributing to other users still needs platform
> signing/notarization, and macOS Gatekeeper will warn until then.

- **`src/bundle/window.ts`** default-exports a `BundleWindow`:

```ts
type BundleWindow = {
    title?: string
    width?: number
    height?: number
    menu?: BundleMenu[]      // custom top-level menus between Edit and Window
    config?: StandardSchemaV1 // overrides the first-run setup form (defaults to the env schema)
}
```

- The standard App/Edit/Window menus plus a File menu (Start / Connect /
  Disconnect) are always installed. Custom menu items are either an `emit` (a
  `belte:menu` CustomEvent into the page) or a `navigate` (repoints the window).
- **`onMenu`** (`bundle/onMenu`) subscribes to those emits inside a Svelte `$effect`:

```ts
$effect(() => onMenu('reload', () => location.reload()))
```

- **`src/bundle/disconnected.svelte`** overrides the default connect screen.
- **`src/bundle/icon.png`** is the app icon.
- **`bundled()`** (`shared/bundled`) is `true` when running inside the desktop
  webview (or, server-side, the embedded server process).

---

## Some details

### Config / env

`env(schema)` (`server/env`) validates `Bun.env` against a Standard Schema at boot
— a missing or malformed variable fails the boot with every issue listed, instead
of surfacing as `undefined` in a handler. The conventional home is
`src/server/config.ts`, eager-imported at boot:

```ts
// src/server/config.ts
import { env } from '@belte/belte/server/env'
import { z } from 'zod'
export const config = env(z.object({ DATABASE_URL: z.string(), STRIPE_KEY: z.string() }))
```

The same schema drives the desktop bundle's first-run setup form. `appDataDir()`
(`server/appDataDir`) returns the running bundle's per-user data directory.

### App hooks

All optional, exported from `src/app.ts`:

| hook | signature | role |
| --- | --- | --- |
| `forwardHeaders` | `string[]` | extra inbound header names to forward onto in-process rpc Requests |
| `init` | `({ server }) => void \| (() => void)` | boot setup; an optional returned cleanup runs on SIGINT/SIGTERM |
| `handle` | `(req, next) => Response` | single middleware; mutate the response or branch on the URL |
| `handleError` | `(error, req) => Response` | catches thrown handler errors |

### Project layout

```text
src/
  app.ts                     # optional hooks
  server/
    config.ts                # env(schema)
    rpc/<name>.ts            # one verb each → /rpc/<name>
    sockets/<name>.ts        # one socket each
  browser/
    pages/**/page.svelte     # routes
    pages/**/layout.svelte   # nearest-only layouts
    pages/**/error.svelte    # nearest-only error pages
    public/                  # static files served at the site root
  mcp/
    resources/               # belte://resources/<path>
    prompts/**.md            # MCP prompts
  bundle/
    window.ts                # BundleWindow
    disconnected.svelte      # connect screen override
    icon.png
  cli/
    banner.txt
    footer.txt
```

### CLI commands

| command | does |
| --- | --- |
| `bunx belte scaffold <name>` | scaffold a new project |
| `belte dev` | build + run with hot reload |
| `belte build` | build the client into `dist/_app/` |
| `belte start` | run the production server against `dist/` |
| `belte run <file> [args]` | run a script under the belte preload (same runtime as the server) |
| `belte compile [--target] [--out]` | build a standalone server executable |
| `belte cli [--target] [--out] [--platforms]` | build the thin CLI binary |
| `belte bundle` | build a movable desktop app for this platform |

### Bundling targets

`--target` / `--platforms` accept Bun's target triples:

| target |
| --- |
| `bun-darwin-arm64` |
| `bun-darwin-x64` |
| `bun-linux-arm64` |
| `bun-linux-x64` |
| `bun-windows-x64` |

### Logging

The shared logger prefixes `[belte]` and colours request lines by method/status.
`DEBUG=<scope>` enables scoped debug output; **`DEBUG=belte` prints the boot
surface map** shown at the top of this document — the auditable list of every page,
socket, and rpc with the surfaces it reaches.
