# belte

**Write one function. Get a web app, a CLI, and an AI tool — from the same line of code.**

belte is an isomorphic SSR + SPA framework for Bun and Svelte: declare a
function once and it serves an SSR/browser call, an HTTP + OpenAPI operation, an
MCP tool, and a CLI subcommand. The bundler swaps the runtime per build target —
the same name is a direct call on the server and a network fetch on the client.

```ts
// src/server/rpc/getWeather.ts — the filename is the rpc's identity and its URL
import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { z } from 'zod'

export const getWeather = GET(({ city }) => json(forecast(city)), {
    inputSchema: z.object({ city: z.string() }),
})
```

One declaration fans out to every surface:

```text
getWeather ─┬─ await cache(getWeather)({ city })   SSR + browser call
            ├─ GET /rpc/getWeather?city=…          HTTP + OpenAPI op
            ├─ getWeather                          MCP tool (read-only)
            └─ app getWeather --city=…             CLI subcommand
```

Boot with `DEBUG=belte` and the exposure is a map, not a guess:

```text
pages:
  page                 layout  error
  /                    layout  ·
  /about               layout  ·
sockets:
  socket               schema  browser  mcp  cli  publish
  chat                 ✓       ✓        ✓    ✓    ✓
rpcs:
  http                 schema  browser  mcp  cli
  GET   /rpc/getWeather  ✓       ✓        ✓    ✓
  POST  /rpc/createPost  ✓       ✓        ·    ✓
```

A declared schema is what gates the machine surfaces (MCP/CLI/OpenAPI); a
mutating verb never auto-exposes to MCP — it needs an explicit `clients: { mcp: true }`.

- Zero runtime dependencies.
- One runtime: Bun (`engines.bun >= 1.3`), Svelte the only required peer.

```sh
bunx belte scaffold myapp   # scaffolds, installs, and starts dev — one command
```

## Layout

Imports name the side they run on: `@belte/belte/server/*` is server-only,
`@belte/belte/browser/*` is client-only, `@belte/belte/shared/*` is isomorphic
(same callable, same behaviour both sides — e.g. `shared/cache`, `shared/HttpError`,
`shared/url`, `shared/health`). `shared` is an import namespace, not a project
directory. A project:

```text
src/
  app.ts                  optional app hooks (see Reference)
  server/
    config.ts             $server/config — env(schema), validated at boot
    rpc/<name>.ts         one verb export per file → /rpc/<name>
    sockets/<name>.ts     one socket export per file
  browser/
    pages/                page.svelte + nearest layout.svelte + error.svelte
    public/               static files served at the site root
  mcp/
    prompts/<name>.md     MCP prompt templates
    resources/            MCP resources
  bundle/window.ts        desktop-bundle window + menu config (optional)
  cli/                    banner.txt / footer.txt for the CLI binary
```

## rpc

One named export per file under `src/server/rpc/`. The export name is the rpc's
identity; the file path is its URL under `/rpc/`. The verb you import
(`GET` / `POST` / `PUT` / `PATCH` / `DELETE` / `HEAD`) picks the HTTP method.

```ts
import { POST } from '@belte/belte/server/POST'
import { json } from '@belte/belte/server/json'

export const createPost = POST(({ title }) => json(db.insert({ title })), {
    inputSchema: z.object({ title: z.string() }),
    clients: { mcp: true }, // a mutation must opt in to MCP explicitly
})
```

| option | default | effect |
| --- | --- | --- |
| `inputSchema` | — | validates args (422 on failure); gates + describes the machine surfaces |
| `outputSchema` | — | types the 200 body for OpenAPI + the MCP tool's `outputSchema` |
| `filesSchema` | — | validates multipart `File` parts (kept off the JSON-Schema projection) |
| `clients` | `browser` always; `cli` when a schema is present; `mcp` when read-only **and** schema | which surfaces expose the verb |
| `crossOrigin` | `false` | exempt a mutating verb from the same-origin gate |
| `maxBodySize` | — | cap actual received body bytes (413 past it); else Bun's server-wide ceiling |

Every rpc is callable three ways:

| form | returns | |
| --- | --- | --- |
| `fn(args)` | `Promise<Return>` | Content-Type-decoded body; throws `HttpError` on non-2xx |
| `fn.raw(args)` | `Promise<Response>` | the raw Response — status, headers, body streaming |
| `fn.stream(args)` | `Subscribable<Return>` | jsonl/sse frames, consumed with `tail()` |

> GET/DELETE/HEAD args travel as a query string, so every value arrives as a
> string — coerce in the schema (`z.coerce.number()`), don't expect a number.

Schemas whose library lacks a native `toJSONSchema()` (needed for OpenAPI / MCP /
CLI) wrap once at declaration with `withJsonSchema(schema, toJsonSchema)`.

## Response helpers

| helper | response |
| --- | --- |
| `json(data, init?)` | `application/json` (204 when `data` is `undefined`) |
| `jsonl(iterable, init?)` | `application/jsonl` stream — one JSON value per line |
| `sse(iterable, init?)` | `text/event-stream` with a 15s keepalive |
| `error(status, message?, init?)` | `text/plain`; the client `HttpError` carries the message |
| `redirect(url, status=302, init?)` | 3xx; accepts relative URLs |

All default to `Cache-Control: no-store` (rpc replies shouldn't sit in shared
caches); the positional `status` and any explicit header override the default.

## Request scope

Inside an SSR render or rpc handler the inbound request is reachable by call,
backed by an `AsyncLocalStorage` scope (each throws outside one):

| call | returns |
| --- | --- |
| `request()` | the inbound `Request` |
| `cookies()` | Bun `CookieMap` — reads parse `Cookie`, writes flush as `Set-Cookie` on return |
| `server()` | the live `Bun.serve` instance (`.publish`, `.requestIP`, …) |

> In-process calls (SSR, MCP, CLI) forward only an allowlist — `cookie`, `authorization`, `traceparent`, `tracestate`, `x-forwarded-*`. A handler reading any other inbound header sees nothing; add the names you rely on via `forwardHeaders` in `src/app.ts`.

## Security defaults

- A browser request whose `Origin` doesn't match the app's host is **403** on every mutating verb (CSRF / CSWSH); native clients send no Origin and pass. `crossOrigin: true` opts a verb out. The `/__belte/mcp` mount and socket publishes get the same check; GET reads stay open cross-origin.
- Boot warns when MCP tools are exposed with no `app.handle` to authenticate them.

`app.handle` is the auth seam — one middleware wrapping every request:

```ts
// src/app.ts
import type { AppModule } from '@belte/belte/server/AppModule'

export const handle: AppModule['handle'] = async (request, next) => {
    if (!(await authorized(request))) return new Response('unauthorized', { status: 401 })
    return next(request)
}
```

> The Origin gate compares against the request's own host — behind a
> TLS-terminating proxy, preserve the original `Host` so same-origin posts aren't
> read as cross-site.

## Sockets

One named export per file under `src/server/sockets/`. A `Socket<T>` is a
bidirectional named broadcast primitive — the same import is a server fan-out and
a client ws proxy by build target.

```ts
// src/server/sockets/chat.ts
import { socket } from '@belte/belte/server/socket'

export const chat = socket<ChatMessage>({ tail: 50, clientPublish: true, schema })
```

| option | default | effect |
| --- | --- | --- |
| `tail` | — | retain the last N frames so late joiners / `.tail()` seed from them |
| `ttl` | — | evict retained frames older than N ms (lazy, no timer) |
| `clientPublish` | `false` | accept `publish` frames from browser / CLI clients |
| `schema` | — | validate publish payloads (sync); gate + describe MCP/CLI |
| `clients` | browser; mcp/cli when a schema is present | which surfaces expose the socket |

`publish(message)` is isomorphic — server-side it notifies in-process iterators and fans out over Bun's native `server.publish`; client-side it sends a `pub` frame. Iterating the socket (`for await … of chat`) is the live stream; `.tail(count)` replays retained frames before going live.

## cache

`cache(fn, options?)` returns an invoker; calling it dedupes identical in-flight
calls (always) and retains the result per `ttl`. Keys derive from method+url+args
(remote) or producer-reference+args (plain function).

```ts
const post = await cache(getPost)({ id })          // dedupe + retain
cache(createPost, { ttl: 0 })({ title })           // mutation idiom: coalesce, retain nothing
```

| option | default | effect |
| --- | --- | --- |
| `ttl` | forever | ms after resolve to keep the entry; `0` = dedupe only, nothing retained |
| `scope` | — | free-form tag(s) grouping calls for one `cache.invalidate({ scope })` |
| `global` | request-scoped | put the entry in the process store, reused across requests |
| `invalidate` | drop-and-reload | `{ throttle }` / `{ debounce }` ms — stale-while-revalidate on invalidate hits |

`cache.invalidate(selector?, args?)` drops matching entries (or coalesces a refetch under a policy) and re-runs readers. `cache.on(source, handler)` binds a socket/stream to event-driven cache maintenance; the handler's context carries a scoped `invalidate` (drop, then refetch) and `patch(selector, updater)` (fold the frame's authoritative delta into matching entries with no refetch), and replays its coverage on reconnect.

During SSR the consumption form decides inline vs streaming (Svelte's `{#await}` rule): a top-level `await cache(fn)()` blocks render and bakes the value into the HTML; `{#await cache(fn)()}` flushes the shell and streams the value in.

- Warm SSR keys return synchronously (`Promise<Return> | Return`), matching the hydrated DOM — consume via `await`/`{#await}`, never `.then`/`.catch`.
- A top-level `await` sweeps every sibling `{#await}` in the component into await-everything mode — isolate blocking reads in child components to keep siblings streaming.
- Producers key on reference identity — hoist to a named binding so calls coalesce (an inline arrow never dedupes, and warns once).

## pending / refreshing

Reactive probes over the cache and stream registries. They **report, never act** — reading one opens no fetch and no stream — and take `cache.invalidate`'s selector grammar.

```ts
const loading = $derived(pending(getPost, { id }))      // no value yet
const stale = $derived(refreshing(getPost, { id }))     // value held, fresher in flight
```

## Pages

- Every `page.svelte` under `src/browser/pages/` mounts at its folder's URL;
  `[id]` / `[...rest]` segments become params.
- `layout.svelte` is nearest-only — the deepest match wraps the page; layouts
  don't stack.
- `error.svelte` is the boundary for throws during render, server and client.

```svelte
<script lang="ts">
import { page, navigate } from '@belte/belte/browser/page'
</script>

<a href="/about" onclick={(e) => { e.preventDefault(); navigate('/about') }}>About</a>
<p>route: {page.route} — {page.params.id}</p>
```

`page` is reactive route/params/url state; `page.url` is browser-space on both sides (under a mount base, compare against `url()` output). `navigate()` does SPA navigation, falling back to a hard load for non-SPA targets.

## tail

Reactive consumer for any `Subscribable<T>` — a `Socket<T>` or `fn.stream(args)`.

```ts
const latest = $derived(tail(chat))                 // T | undefined, latest-wins
const recent = $derived(tail(chat, { last: 20 }))   // T[], live window
```

`tail.status(x)` is `pending | open | done | error`; `tail.error(x)` surfaces the
error without throwing. A transport loss retains the window, flags `refreshing`,
and reconnects on backoff — never an error. `tail` is a no-op during SSR — seed
the value with `cache()` against an rpc handler, then layer `tail()` on top.

## health, online, trace, log

Reactive liveness and connectivity, polling only while a tracking scope reads them:

```ts
const { reachable, authenticated } = $derived(health())  // app.health() fields merge in
const connected = $derived(online())                     // navigator.onLine, reactive
```

`health()` polls `/__belte/health`; the `app.health(request)` hook adds public
fields to the payload. Both are constant-`true` on the server.

```ts
import { log } from '@belte/belte/shared/log'
import { trace } from '@belte/belte/shared/trace'

log('order placed', { id })   // tsv (or JSON under BELTE_LOG_FORMAT=json), request-scoped
const traceparent = trace()   // the request's W3C traceparent, isomorphic
```

## url

`url(path, …)` resolves any in-app path to its base-correct, typed form so a
project mounted under `APP_URL`'s subpath keeps every link, asset ref, and rpc
href within the mount.

```ts
url('/product/[id]', { id }, { ref })   // page route: params, then query
url('/rpc/search', { q })               // rpc: the verb's args, serialised to query
```

## agent

`agent(engine, messages)` runs a model engine against the app's own MCP surface
(already gated by each verb's `clients.mcp`) and yields a provider-neutral frame
stream. The handler picks the transport.

```ts
import { agent } from '@belte/belte/server/agent'
import { jsonl } from '@belte/belte/server/jsonl'
import { engine } from '@belte/anthropic'

const chatEngine = engine({ model: 'claude-opus-4-8', apiKey: config.ANTHROPIC_API_KEY })
export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), { inputSchema })
```

Engines are provider packages (`@belte/<provider>`); they see the surface in and
emit `AgentFrame`s out, so swapping providers never touches the verb or the UI.

## MCP, CLI, bundle

| surface | what it is | how |
| --- | --- | --- |
| MCP | schema-bearing read verbs (+ `clients.mcp` mutations) + sockets, plus `src/mcp/prompts/*.md` and resources | JSON-RPC at `/__belte/mcp` |
| CLI | a thin remote client with the rpc manifest baked in, shipping the server beside it | `belte cli` → `<app> <command> --flags` |
| bundle | a movable desktop app — server + launcher + webview, with a connect screen | `belte bundle`; window/menu via `src/bundle/window.ts`, `onMenu()`, `bundled()`, `appDataDir()` |

## Deploy

belte runs as a single Bun process: the `global` cache, socket retention, and fan-out are all process memory — two replicas share neither, so run one process and scale through an external store, or pin clients to it.

`belte compile` builds a self-contained binary — runtime and zstd-packed assets embedded — so the runtime image needs neither Bun nor `node_modules`:

```dockerfile
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run compile               # → dist/app

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=build /app/dist/app ./app
ENV PORT=3000
EXPOSE 3000
CMD ["./app"]
```

Cross-compile for another target with `belte compile --target=bun-linux-arm64`. `PORT` binds exactly (a collision fails loudly); unset, the listener scans up from 3000. `BELTE_IDLE_TIMEOUT` raises Bun's per-connection idle cap (streams opt out).

## Reference

| command | does |
| --- | --- |
| `belte scaffold <name>` | scaffold a project, install, start dev |
| `belte dev` | build the client + run the server with hot reload |
| `belte build` | build the client into `dist/_app/` |
| `belte start` | run the production server against `dist/` |
| `belte run <file>` | run a script under the belte preload (same runtime as the server) |
| `belte compile` | build a standalone server binary (`--target`, `--out`) |
| `belte cli` | build the CLI binary (`--platforms` to cross-compile) |
| `belte bundle` | build a movable desktop bundle for this platform |

| route | serves |
| --- | --- |
| `/__belte/health` | liveness + identity payload (`/__belte/identity` is a compatibility alias) |
| `/__belte/mcp` | MCP JSON-RPC endpoint |
| `/__belte/sockets/<name>` | HTTP face of a socket — tail (SSE/JSON) and publish |
| `/__belte/cli` | CLI install script + per-platform binary download |
| `/openapi.json` | OpenAPI 3.1 document of the `/rpc/*` surface |

| env | effect |
| --- | --- |
| `PORT` | bind port (exact; unset scans from 3000) |
| `APP_URL` | public URL — its pathname becomes the mount base |
| `BELTE_IDLE_TIMEOUT` | Bun per-connection idle seconds (default 10) |
| `BELTE_MAX_REQUEST_BODY_SIZE` | server-wide body ceiling |
| `BELTE_LOG_FORMAT` | `json` for one JSON object per log line (default tsv) |
| `DEBUG` | `belte` prints the boot surface map; `-belte` silences request logs |
| `BELTE_DATA_DIR` | override the bundle's per-user data dir |
| `BELTE_APP_URL` / `BELTE_APP_TOKEN` | CLI client's default server + bearer token |

Typed environment — validated at boot, every issue reported at once:

```ts
// src/server/config.ts
import { env } from '@belte/belte/server/env'
export const config = env(z.object({ DATABASE_URL: z.string(), PORT: z.coerce.number() }))
```

`src/app.ts` exports optional hooks: `handle`, `init`, `handleError`, `health`,
`forwardHeaders` (all optional; see `AppModule`).

Testing — `createTestClient` dispatches in-process through the same scope as a
live request:

```toml
# bunfig.toml
[test]
preload = ["@belte/belte/preload"]
```

```ts
import { createTestClient } from '@belte/belte/test/createTestClient'
import './src/server/rpc/getWeather.ts'

const api = createTestClient()
expect(await api.getWeather({ city: 'NYC' })).toEqual(expected)
```

MIT
