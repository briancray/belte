# belte

**Write one function. Get a web app, a CLI, and an AI tool — from the same line of code.**

belte is an isomorphic, multimodal HTTP framework for Bun and Svelte. You declare a function once; the bundler swaps the runtime per target, so the same callable renders on the server, fetches from the browser, and exposes itself to machines.

```ts
// src/server/rpc/getProduct.ts — file path is the URL, export is the verb
import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { z } from 'zod'

export const getProduct = GET(({ id }) => json(products.find(id)), {
    inputSchema: z.object({ id: z.string() }),
})
```

That one declaration fans out across every surface — each line a real consume form:

```text
getProduct
  ├─ cache(getProduct)({ id })    SSR render + browser fetch (one call)
  ├─ GET /rpc/getProduct?id=42    HTTP endpoint + OpenAPI operation
  ├─ mcp__app__getProduct { id }  MCP tool (read-only schema → auto)
  └─ app getProduct --id 42       CLI subcommand
```

`DEBUG=belte` prints the boot surface map — every page, socket, and rpc with the surfaces it reaches:

```text
pages:
  page                    layout  error
  /                       /       ·
  /product/[id]           /       /
sockets:
  socket                  schema  browser  mcp  cli  publish
  chat                    ✓       ✓        ✓    ✓    ·
rpcs:
  http                    schema  browser  mcp  cli
  GET   /rpc/getProduct   ✓       ✓        ✓    ✓
  POST  /rpc/createOrder  ✓       ✓        ·    ✓
```

A schema gates the machine surfaces: without one a verb is browser-only. A read-only verb with a schema auto-exposes to MCP and CLI; a mutation never auto-exposes to MCP — it needs explicit `clients: { mcp: true }`.

- Zero runtime dependencies.
- One runtime — Bun (`>=1.3.0`); Svelte 5 is the only required peer.

```sh
bunx @belte/belte scaffold my-app   # scaffolds, installs, and starts the dev server
```

## Layout

Imports come from three namespaces, each marking the side a name runs on: `@belte/belte/server/*` (server-only — `GET`, `json`, `socket`, `request`, `env`, `agent`, `appDataDir`), `@belte/belte/browser/*` (client — `page`, `navigate`, `tail`), and `@belte/belte/shared/*` (isomorphic — `cache`, `pending`, `refreshing`, `HttpError`, `url`, `withJsonSchema`, `log`). There is no umbrella entry point; every name has its own path. `shared/*` is an import namespace, not a project directory.

A project:

```text
src/
  app.ts                lifecycle hooks (all optional — see Reference)
  server/
    config.ts           env(schema) — typed Bun.env, validated at boot
    rpc/getProduct.ts   one verb per file; file path = URL, export = method
    sockets/chat.ts     one socket per file
  browser/
    pages/              page.svelte / layout.svelte / error.svelte
    public/             static files, served at the site root
  mcp/
    prompts/greet.md    MCP prompts (frontmatter + template body)
    resources/          MCP resources (served from disk or embedded)
  shared/               your isomorphic code (the $shared/* alias)
  cli/  bundle/         optional CLI help chrome + desktop bundle config
```

## rpc

One named export per file under `src/server/rpc/`, bound to an HTTP verb: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`. The export name is the function; the file path (under `/rpc/`) is the URL.

```ts
import { POST } from '@belte/belte/server/POST'
import { json } from '@belte/belte/server/json'

export const createOrder = POST(({ items }) => json(db.orders.create(items)), {
    inputSchema: orderSchema,
})
```

| option | type | default | meaning |
| --- | --- | --- | --- |
| `inputSchema` | Standard Schema | — | validates args (422 on failure); feeds OpenAPI / MCP / CLI |
| `outputSchema` | Standard Schema | — | success-body schema for the OpenAPI 200 + MCP `outputSchema` |
| `filesSchema` | Standard Schema | — | validates multipart `File` parts (kept off the JSON-Schema projection) |
| `clients` | `{ browser, mcp, cli }` | see below | which surfaces expose the verb |
| `crossOrigin` | boolean | `false` | exempt a mutating verb from the same-origin gate |

`clients` defaults per declaration: `browser: true` always; `cli: true` when a schema is present; `mcp: true` only when a schema is present **and** the method is read-only (`GET`/`HEAD`). Explicit values always win.

| consume | result |
| --- | --- |
| `getProduct(args)` | decoded body; throws `HttpError` on non-2xx |
| `getProduct.raw(args)` | the underlying `Response` (status / headers / streaming) |
| `getProduct.stream(args)` | a `Subscribable` for `tail()` to read frame-by-frame |

> Query args ride the URL as strings — a `GET`/`DELETE` verb that expects numbers or booleans must coerce in its schema (e.g. `z.coerce.number()`); a bare `z.number()` rejects the string.

Any [Standard Schema](https://standardschema.dev) library works (zod, valibot, arktype). JSON Schema is projected from each schema's own `toJSONSchema()`; wrap a schema whose library lacks one with `withJsonSchema(schema, toJsonSchema)`.

## Response helpers

`@belte/belte/server/*` — each returns a `TypedResponse<T>` so the verb infers its return type from the handler body.

| helper | returns |
| --- | --- |
| `json(data, init?)` | JSON body |
| `error(status, message?, init?)` | text/plain error; `message` defaults to the status reason phrase |
| `redirect(url, status=302, init?)` | 3xx with `Location`; accepts relative URLs |
| `jsonl(asyncIterable, init?)` | newline-delimited JSON stream (`tail(fn.stream())` reads it) |
| `sse(asyncIterable, init?)` | Server-Sent Events stream with keep-alive |

All default `Cache-Control: no-store` (override via `init.headers`); the streaming pair also sets `X-Content-Type-Options: nosniff`.

## Request scope

Server-only, resolved through an `AsyncLocalStorage` store; each throws if called outside a request (SSR render or rpc handler).

| call | from `@belte/belte/server/*` | gives |
| --- | --- | --- |
| `request()` | `request` | the inbound `Request` |
| `cookies()` | `cookies` | Bun `CookieMap` — read inbound, `set`/`delete` flush as `Set-Cookie` |
| `server()` | `server` | the live `Bun.serve` instance (no-op shim for in-process CLI/MCP/test calls) |

> When SSR or an MCP call invokes a verb in-process, only an allowlist is forwarded onto the synthesized request — `cookie`, `authorization`, and the `x-forwarded-*` hints. A handler that reads any other inbound header (e.g. `accept-language`, a trace id) sees nothing unless you list it via `forwardHeaders` in `src/app.ts`.

## Security defaults

- A browser request whose `Origin` doesn't match the app's host is refused **403** on every mutating verb (anything but `GET`/`HEAD`); `crossOrigin: true` opts a verb out. Origin-less native clients (curl, CLI, MCP) always pass.
- The `/__belte/mcp` mount and the socket publish face get the same Origin check.
- Boot prints a warning when MCP tools are exposed with no `app.handle` to authenticate machine clients.

```ts
// src/app.ts — single middleware; auth, rewrite, or branch before the handler runs
export async function handle(request: Request, next: (req: Request) => Promise<Response>) {
    if (!authorized(request)) return new Response('Unauthorized', { status: 401 })
    return next(request)
}
```

> The Origin check compares against the request's own host, so a TLS-terminating proxy must forward the original `Host` header (e.g. nginx `proxy_set_header Host $host`).

## Sockets

One export per file under `src/server/sockets/`. The socket is the live `AsyncIterable`; `publish` is isomorphic (server-side it fans out; client-side it sends a frame the server validates).

```ts
import { socket } from '@belte/belte/server/socket'

export const chat = socket<ChatMessage>({ tail: 50, schema: chatSchema })
```

| option | type | default | meaning |
| --- | --- | --- | --- |
| `tail` | number | `0` | retain the last N frames so late joiners / reconnects can seed |
| `ttl` | number | — | evict retained frames older than `ttl` ms before replay |
| `clientPublish` | boolean | `false` | accept publishes from clients over the wire |
| `schema` | Standard Schema | — | validate payloads; unlocks the MCP/CLI surfaces |
| `clients` | `{ browser, mcp, cli }` | browser-only, or all when a schema is present | which surfaces expose it |

`chat.publish(msg)` broadcasts; `for await (const msg of chat)` iterates live. On the client, read it through `tail()` (below). A schema-bearing socket exposes a `<name>-tail` MCP/CLI read tool, plus `<name>-publish` when `clientPublish` is set.

## cache

`cache(fn, options?)` returns an invoker that dedupes identical in-flight calls and (with `ttl`) retains the result. Reactive: a read inside a `$derived`/`$effect` re-runs when its key is invalidated.

```ts
import { cache } from '@belte/belte/shared/cache'

const product = await cache(getProduct)({ id })        // cached read
await cache(createOrder, { ttl: 0 })({ items })        // dedupe-only mutation idiom
```

| option | type | meaning |
| --- | --- | --- |
| `ttl` | number | `undefined` → forever; `0` → dedupe only; `> 0` → expire N ms after resolve |
| `global` | boolean | store process-wide instead of per-request (memoise an external endpoint) |
| `scope` | string \| string[] | tag entries so `cache.invalidate({ scope })` can target a group |
| `invalidate` | `{ throttle }` \| `{ debounce }` | stale-while-revalidate refetch policy (rejected on a write method) |

`cache.invalidate(selector?)` drops matching entries (or coalesces a refetch under a policy); a selector is a remote/producer function, `{ scope }`, or nothing for all. On the server, how you consume the call decides the SSR mode: a top-level `await` inlines the value into the first HTML chunk; a `{#await}` block streams it in on the same response when it resolves.

- `cache(fn)` returns `Promise<Return> | Return` — a warm SSR value comes back synchronously, so consume only via `await` / `{#await}`, never `.then`/`.catch`.
- A top-level `await` flips Svelte into await-everything mode and inlines every read in that component instance; isolate a blocking read in its own child to keep siblings streaming.
- A producer (`cache(fetchRates)`) keys on the function reference — hoist it to a named binding; an inline arrow mints a fresh identity each call and never dedupes (it warns once).

## pending / refreshing

`@belte/belte/shared/*` — reactive probes over both the cache and the tail registry. They report, never act: reading one opens no fetch and no stream.

```ts
import { pending } from '@belte/belte/shared/pending'
import { refreshing } from '@belte/belte/shared/refreshing'

const loading = $derived(pending(getProduct))     // no value yet
const updating = $derived(refreshing(getProduct)) // held value being superseded
```

`pending(arg?)` is true when there's no value yet (any call/stream, a function's calls, a `{ scope }`, or a stream). `refreshing(arg?)` is true when a held value is being revalidated. Both take the same selector grammar as `cache.invalidate`.

## Pages

- Routes are folders under `src/browser/pages/`: `page.svelte` renders, `[id]`/`[...rest]` are dynamic segments.
- `layout.svelte` and `error.svelte` wrap the nearest matching prefix — nearest only, no stacking.
- A throw during render (server or client) swaps in the nearest `error.svelte` with `{ status, message, stack }`.

```svelte
<script>
  import { page } from '@belte/belte/browser/page'
  import { navigate } from '@belte/belte/browser/navigate'
</script>

<a href="/product/{id}" onclick={(e) => (e.preventDefault(), navigate(`/product/${id}`))}>
  {page.params.id}
</a>
```

`page` exposes reactive `route` / `params` / `url` / `navigating`. `navigate(href, { replace?, scroll? })` does SPA navigation, resolving the target view before touching history and hard-navigating any non-SPA URL.

## url

`url(path, …)` builds a typed, base-correct in-app URL — links, asset refs, and rpc hrefs through one helper. It resolves three path kinds off the path itself: an rpc path (`/rpc/*`) takes the verb's own args serialised to a query, a page route takes its `[id]` params then an optional query, and a bare asset/path takes an optional query. Scheme-qualified or protocol-relative URLs pass through untouched.

```ts
import { url } from '@belte/belte/shared/url'

url('/product/[id]', { id: 42 })       // /product/42
url('/rpc/search', { q: 'shoes' })     // /rpc/search?q=shoes
url('/logo.svg')                       // /logo.svg
```

When the app is mounted under a subpath via `APP_URL` (e.g. `https://app.com/v2`), `url()` and the shell's `/_app/` asset refs carry that base so every rooted internal link stays inside the mount; the server still routes at root, so pair it with a proxy that strips the prefix.

## tail

`tail(subscribable)` is the reactive client reader for a `Socket<T>` or an rpc `fn.stream(args)`.

```svelte
<script>
  import { tail } from '@belte/belte/browser/tail'
  const latest = $derived(tail(chat))                 // T | undefined — latest frame
  const recent = $derived(tail(chat, { last: 20 }))   // T[] — live window of ≤20
</script>
```

`tail.status(x)` is `pending | open | done | error`; `tail.error(x)` surfaces the error (never thrown, so a read can't crash the component). A socket disconnect retains the window, flags `refreshing`, and reconnects with backoff. `tail` is a no-op on the server — seed the initial HTML with `cache()` against an HTTP verb, then layer `tail()` on top for live updates after hydration.

## agent

`agent(engine, messages)` runs a model engine against the current request's MCP surface and yields a provider-neutral frame stream; the handler picks the transport with `jsonl()` or `sse()`.

```ts
import { agent } from '@belte/belte/server/agent'
import { jsonl } from '@belte/belte/server/jsonl'
import { engine } from '@belte/anthropic'

const chatEngine = engine({ model: 'claude-opus-4-8', apiKey: config.ANTHROPIC_API_KEY })
export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), { inputSchema })
```

Engines are provider packages (`@belte/<provider>`) that map neutral messages to a provider's wire shape — swapping providers never touches the verb or the UI. The surface is already gated by each verb's `clients.mcp` plus its own handler auth.

## MCP / CLI / bundle

Every machine surface is generated from the same declarations — no second definition.

| surface | what it is | build |
| --- | --- | --- |
| MCP | `/__belte/mcp` — tools from MCP-exposed verbs/sockets, prompts, resources | always mounted |
| CLI | a standalone binary; subcommands from CLI-exposed verbs | `belte cli` |
| bundle | a movable desktop app (server + launcher + webview) | `belte bundle` |

Desktop bundle config lives in `src/bundle/`: `BundleWindow` / `BundleMenu` / `BundleMenuItem` shape the native window and menus, `onMenu` handles menu events, `bundled()` detects the bundled context, and `appDataDir()` returns the app's per-user data dir (DB, cache) so its storage lands beside its config.

## Deploy

belte is single-process: the `global` cache store, socket retention, and live fan-out are all process memory. One `Bun.serve` instance owns them, so scale vertically — a second process shares none of that state. `PORT` pins the listener (else it scans up from 3000); `BELTE_IDLE_TIMEOUT` sets the per-connection idle seconds (default 10); `APP_URL` pins the public origin for absolute URLs, and its pathname mounts the app under a subpath (e.g. `/v2`).

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "start"]
```

Or ship a single file: `belte compile` produces a standalone executable (`--target=<bun triple>` cross-compiles, e.g. `bun-linux-arm64`).

## Reference

| command | does |
| --- | --- |
| `belte dev` | build the client + run the server with hot reload |
| `belte build` | build the client into `dist/_app/` |
| `belte start` | run the production server against `dist/` |
| `belte run <file>` | run a script under the belte preload (same runtime as the server) |
| `belte compile` | build a standalone server executable |
| `belte cli` | build the CLI binary (ships the server beside it) |
| `belte bundle` | build a movable desktop app bundle for this platform |

| route | surface |
| --- | --- |
| `/*` | pages (SSR + SPA) |
| `/rpc/*` | rpc verbs |
| `/__belte/sockets` | socket multiplex (one ws per client) |
| `/__belte/mcp` | MCP endpoint |
| `/__belte/cli` | CLI install / download |
| `/__belte/identity` | server identity probe |
| `/openapi.json` | OpenAPI document |
| `/_app/*` | built client assets |

```ts
// src/server/config.ts — eager-imported at boot; import `config` from $server/config anywhere
import { env } from '@belte/belte/server/env'
import { z } from 'zod'

export const config = env(z.object({ DATABASE_URL: z.string(), PORT: z.coerce.number() }))
```

`src/app.ts` exports optional hooks: `init` (returns a cleanup run on SIGINT/SIGTERM), `handle`, `handleError`, `forwardHeaders`.

Tests run in-process — no server, no network. Add `preload = ["@belte/belte/preload"]` under `[test]` in `bunfig.toml`, then:

```ts
import { createTestClient } from '@belte/belte/test/createTestClient'

const api = createTestClient({ headers: { cookie: 'session=abc' } })
const order = await api.createOrder({ items })       // runs in a real request scope
```

MIT
