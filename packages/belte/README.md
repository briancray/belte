# belte

**Write one function. Get a web app, a CLI, and an AI tool — from the same line of code.**

belte is an isomorphic, multimodal HTTP framework for Bun and Svelte. You declare a
function once; the bundler swaps its runtime per build target, so the same name is an
SSR call, a browser `fetch`, an HTTP + OpenAPI operation, an MCP tool, and a CLI
subcommand — without you wiring any of them.

- Zero runtime dependencies.
- One runtime — Bun — for dev, build, SSR, the CLI, and the MCP endpoint.

```sh
bunx belte scaffold my-app   # scaffold, install, and start the dev server
```

Or run the kitchen-sink example, which exercises every surface:

```sh
git clone https://github.com/briancray/belte
cd belte && bun install
cd examples/kitchen-sink && bun run dev
```

## Define behaviour once

*One declaration; the bundler fans it out across every front door.*

```ts
// src/server/rpc/getWeather.ts
import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { z } from 'zod'

export const getWeather = GET(async ({ city }) => json(await lookup(city)), {
    inputSchema: z.object({ city: z.string() }),
})
```

```ts
// src/server/rpc/createPost.ts — a typed failure, exposed as an MCP tool
import { POST } from '@belte/belte/server/POST'
import { json } from '@belte/belte/server/json'
import { error } from '@belte/belte/server/error'
import { z } from 'zod'

const duplicateSlug = error.typed('duplicateSlug', 409, z.object({ slug: z.string() }))

export const createPost = POST(
    ({ slug }) => (taken(slug) ? duplicateSlug({ slug }) : json(save(slug))),
    { inputSchema: z.object({ slug: z.string() }), clients: { mcp: true } },
)
```

That one `getWeather` declaration becomes every front door at once:

```text
            ┌──────────────────────── SSR render + browser fetch
            ├──────────────────────── HTTP route + OpenAPI operation
getWeather ─┤
  one GET   ├──────────────────────── MCP tool       (read-only + schema)
            ├──────────────────────── CLI subcommand  (schema)
            └──────────────────────── typed url() / cache() entry
```

Every page, socket, and rpc — with the surfaces it reaches — prints at boot, so the
exposure is auditable rather than implicit (silence it with `DEBUG=-belte`):

```text
pages:
  page                   layout  error
  /                      layout  ·
  /about                 layout  ·
  /posts/[id]            layout  error
sockets:
  socket                 schema  browser  mcp  cli  publish
  chat                   ✓       ✓        ✓    ✓    ✓
rpcs:
  http                   schema  browser  mcp  cli
  GET   /rpc/getWeather  ✓       ✓        ✓    ✓
  POST  /rpc/createPost  ✓       ✓        ·    ✓
```

A declared `inputSchema` gates the machine surfaces — MCP, CLI, OpenAPI — so an
unschema'd verb stays browser-only (a red `·` in the map). Reads auto-expose to MCP; a
mutating verb reaches MCP only with explicit `clients: { mcp: true }`.

### rpc

One verb per file under `src/server/rpc/`, named after its export: `GET`, `POST`,
`PUT`, `PATCH`, `DELETE`, `HEAD`. The handler takes a single parsed `args` bag (read
the raw `Request` via `request()`) and returns a response helper.

| Option | Default | Effect |
| --- | --- | --- |
| `inputSchema` | — | validate args; gate + describe MCP / CLI / OpenAPI |
| `outputSchema` | — | type the success body for OpenAPI 200 + the MCP tool |
| `filesSchema` | — | validate `File` parts of a multipart upload |
| `clients` | `browser`; `cli` with schema; `mcp` when read-only **and** schema | which surfaces expose the verb |
| `crossOrigin` | `false` | exempt a mutating verb from the same-origin CSRF gate |
| `maxBodySize` | — | cap received body bytes (413 past it) |
| `timeout` | — | per-verb handler deadline in ms — a 504 on every surface |
| `outbox` | `false` | durable delivery: park failed mutations for replay (see below) |

Consume the same exported reference isomorphically — `import { getWeather } from
'$server/rpc/getWeather.ts'`:

| Call | Resolves to |
| --- | --- |
| `getWeather(args)` | the decoded body; throws `HttpError` on non-2xx |
| `getWeather.raw(args)` | the raw `Response` — no decode, no throw |
| `getWeather.stream(args)` | a `Subscribable` of frames, for `tail()` / `cache()` |
| `getWeather.isError(caught, 'kind')` | narrows a caught error to a kind the handler returns (`.kind` / `.data`) |
| `getWeather.outbox()` | the reactive list of *this RPC's* undelivered writes; `.retry()` drains them — durable (`outbox: true`) RPCs only |

Schema libraries without a native `toJSONSchema()` (everything but Zod 4 / Effect /
Arktype) wrap once at declaration with `withJsonSchema(schema, toJsonSchema)`.

> GET/DELETE/HEAD args travel as query strings, so they arrive as strings — coerce in
> the schema (`z.coerce.number()`), don't expect a number. The per-verb `timeout`
> (504, server-side) is distinct from `BELTE_CLIENT_TIMEOUT` (the client's fetch wait).

### Response helpers

A handler returns one of these; the brand carries the body shape into the verb's
inferred type, so no `GET<Args, Return>` annotation is needed.

| Helper | Returns |
| --- | --- |
| `json(data, init?)` | a JSON `Response` (`json(undefined)` → 204) |
| `jsonl(iterable, init?)` | a newline-delimited-JSON stream |
| `sse(iterable, init?)` | a `text/event-stream` |
| `error(status, message?, init?)` | a plain-text non-2xx |
| `error.typed(name, status, schema?)` | a reusable typed-error constructor — return it to raise it |
| `redirect(url, status?, init?)` | a 3xx (defaults 302; relative URLs allowed) |
| `HttpError` | thrown client-side on non-2xx; carries `.status`, `.response`, `.kind`, `.data` |
| `ValidationErrorData` | the `.data` shape of a 422 (`{ issues, fields }`) |

All set `Cache-Control: no-store` by default and let the positional `status` win over
any `init.status`. Returning an `error.typed(...)` constructor serializes a typed body
the client narrows with `rpc.isError(e, name)`; the rpc infers its whole error surface
from the constructors a handler returns, so there is no `errors:` option to declare.

### Request scope

In-scope accessors for a handler or SSR render; each throws outside a request.

| Accessor | Gives |
| --- | --- |
| `request()` | the inbound `Request` (headers, `.signal`, body) |
| `cookies()` | Bun's `CookieMap` — `.get` / `.set` / `.delete`, flushed to `Set-Cookie` |
| `server()` | the live `Bun.serve` instance (`.publish`, `.requestIP`, …) |

> In-process calls (SSR reading a verb, an MCP tool dispatch) forward only an
> allowlist — `cookie`, `authorization`, the `x-forwarded-*` hints, W3C trace context.
> Anything else a handler reads (e.g. `accept-language`, `x-tenant-id`) is dropped
> unless named in `app.ts`'s `forwardHeaders`.

## Build the web app

*The browser half — pages, navigation, reactive data, live streams.*

### Pages

- Every `page.svelte` under `src/browser/pages/` mounts at its folder's URL;
  `[name]` / `[...rest]` segments become route params.
- A `layout.svelte` wraps its subtree and persists across navigation; an
  `error.svelte` is its nearest error boundary.

```svelte
<script>
  import { page } from '@belte/belte/browser/page'
  import { url } from '@belte/belte/shared/url'
</script>

<h1>{page.params.id}</h1>
{#if page.url.pathname === url('/about')} … {/if}
```

`page` is reactive route / params / url state; `page.url` is browser-space on both
sides, so compare it against `url()` output to hydrate identically.

### navigate

```ts
import { navigate } from '@belte/belte/browser/navigate'

await navigate('/posts/1', { replace: false })
```

SPA-navigates to a registered route, resolving the target view before touching
history; unknown routes hard-navigate. A same-pathname change syncs the URL with no
network round-trip.

### cache

`cache()` wraps a verb (or any producer) into a deduped, SSR-replayed, reactive read.

```svelte
<script>
  import { cache } from '@belte/belte/shared/cache'
  import { getWeather } from '$server/rpc/getWeather.ts'
  import { createPost } from '$server/rpc/createPost.ts'

  let city = $state('SF')
  const weather = $derived(await cache(getWeather)({ city }))  // reactive; re-runs on invalidate

  async function publish(post) {
    await cache(createPost, { ttl: 0 })(post)  // ttl:0 dedupes the submit, retains nothing
    cache.invalidate(getWeather)
  }
</script>
```

| Option | Default | Effect |
| --- | --- | --- |
| `ttl` | — (forever) | ms an entry stays live after it settles; `ttl: 0` = dedupe-only |
| `tags` | — | labels for group invalidation |
| `global` | `false` | place the entry in the process-wide store (server), shared across requests |
| `swr` | — | stale-while-revalidate: keep the value, refetch in the background on invalidate |

`cache.invalidate(fn?, args?)` drops (or refetches, under `swr`) matching entries and
re-runs the reactive scopes reading them; `cache.on(source, handler)` folds a
socket/stream's frames into the cache (`ctx.invalidate` / `ctx.patch`).

> - A warm SSR read returns synchronously (`Promise<Return> | Return`), so the first `{#await}` render byte-matches the server DOM.
> - A top-level `await` sweeps in every sibling promise — isolate blocking reads in child components, keep streaming reads in the parent.
> - Hoist a producer to a stable reference; an inline arrow is a new identity each call and never dedupes.
> - SSR snapshots replay GET only; a write can't re-fire unprompted.

### pending / refreshing / online

Probes that report, never act — reading one opens no fetch and no stream.

```svelte
<script>
  import { pending } from '@belte/belte/shared/pending'
  import { refreshing } from '@belte/belte/shared/refreshing'
  import { online } from '@belte/belte/shared/online'
  import { getWeather } from '$server/rpc/getWeather.ts'
</script>

{#if pending(getWeather)}loading…{/if}
{#if refreshing(getWeather)}updating…{/if}
{#if !online()}offline{/if}
```

`pending` answers "no value yet?", `refreshing` "is a held value being superseded?".
`online()` is `navigator.onLine` in the browser and the calling client's reported
connectivity on the server (always true in SSR).

### outbox

Declaring a mutating verb `outbox: true` parks its writes for replay when the server is
unreachable, instead of throwing.

```svelte
<script>
  import { outbox } from '@belte/belte/browser/outbox'
</script>

{#if outbox().length}{outbox().length} unsynced <button onclick={outbox.retry}>sync</button>{/if}
```

`outbox()` is the reactive list of undelivered writes across every durable verb;
`outbox.retry()` drains them (no auto-drain). A single verb's slice is `rpc.outbox`.

### Sockets & tail

One socket per file under `src/server/sockets/`; a `Socket<T>` is async-iterable for
the live stream, `publish(message)` is isomorphic, `.tail(n)` replays retained frames.

```ts
// src/server/sockets/chat.ts
import { socket } from '@belte/belte/server/socket'
import { z } from 'zod'

export const chat = socket<ChatMessage>({ tail: 50, clientPublish: true, schema })
```

| Option | Default | Effect |
| --- | --- | --- |
| `tail` | — | retain this many frames for late joiners / reconnects |
| `ttl` | — | per-frame retention, ms |
| `clientPublish` | `false` | accept `publish` frames from browser / CLI clients |
| `schema` | — | validate publish payloads (sync); gate + describe MCP / CLI |
| `clients` | browser; mcp/cli with schema | which surfaces expose the socket |

Read it in the browser with `tail()`:

```svelte
<script>
  import { tail } from '@belte/belte/browser/tail'
  import { chat } from '$server/sockets/chat.ts'

  const latest = $derived(tail(chat))                 // T | undefined
  const recent = $derived(tail(chat, { last: 20 }))   // rolling window, T[]
</script>
```

`tail.status(chat)` is `'pending' | 'open' | 'done' | 'error'`; a dropped ws keeps the
held window and flags `refreshing()` until it replays. `tail()` is a no-op in SSR —
seed initial state with `cache()`, then layer `tail()` for live updates. Sockets
multiplex onto one framework connection per client at `/__belte/sockets`, fanning out
over Bun's native `server.publish`.

### url

```ts
import { url } from '@belte/belte/shared/url'

url('/posts/[id]', { id: '1' }, { ref: 'home' })   // → /posts/1?ref=home
```

Resolves any in-app path to its typed, base-correct form — when mounted under
`APP_URL`'s subpath (e.g. `/v2`), every generated link, asset ref, and rpc href carries
the prefix.

## Reach it beyond the browser

*The same functions, through every non-browser front door.*

### CLI

`belte cli` builds a standalone binary — a thin remote client that ships the server
beside it. A human runs it as an interactive session against a saved connection; a
script invokes any schema-bearing verb as a one-shot subcommand (`my-app getWeather
--city SF`) and gets the decoded result on stdout. `/__belte/cli` serves a
platform-detecting install script.

### MCP & agent

`/__belte/mcp` is a JSON-RPC MCP endpoint exposing every schema-bearing read verb, each
`clients.mcp` mutation, and each schema-bearing socket as a tool. `agent()` runs a model
engine against that same gated surface and returns its frame stream, which the handler
frames as `jsonl()` or `sse()`:

```ts
// src/server/rpc/chat.ts
import { agent } from '@belte/belte/server/agent'
import { jsonl } from '@belte/belte/server/jsonl'
import { engine } from '@belte/anthropic'

const chatEngine = engine({ model: 'claude-opus-4-8', apiKey: config.ANTHROPIC_API_KEY })
export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), { inputSchema })
```

The engine (a `@belte/<provider>` package) only sees the surface in and frames out, so
swapping providers never touches the rpc or the UI.

### bundle

`belte bundle` packages the app as a movable desktop bundle (a webview + the embedded
server). `BundleWindow` / `BundleMenu` / `onMenu` configure the window and native menus;
`appDataDir()` is the per-user data directory, and `bundled()` reports whether the code
is running inside the bundle.

## Configure, test, ship

*Typed config, an in-process test harness, a single-binary deploy.*

### Configuration

```ts
// src/server/config.ts
import { env } from '@belte/belte/server/env'
import { z } from 'zod'

export const config = env(z.object({ DATABASE_URL: z.url(), STRIPE_KEY: z.string() }))
```

`env(schema)` validates `Bun.env` synchronously at module load, so a missing variable
fails the boot loudly. `src/app.ts` exports optional hooks — `init` (boot + cleanup),
`handle` (request middleware), `handleError` (error fallback), `health` (health-payload
fields), and `forwardHeaders`.

### Security defaults

- A browser request whose `Origin` doesn't match the app's host is **403** on every
  mutating verb (CSRF / CSWSH); native clients send no Origin and pass. `crossOrigin:
  true` opts a verb out; GET reads stay open cross-origin.
- The `/__belte/mcp` mount and socket publishes get the same Origin check.
- Boot warns when MCP tools are exposed with no `app.handle` — the blessed auth seam.

```ts
// src/app.ts
export async function handle(request, next) {
    if (request.url.includes('/rpc/') && !(await authed(request))) {
        return new Response('unauthorized', { status: 401 })
    }
    return next(request)
}
```

> The Origin check compares against the request's own host; behind a proxy, ensure the
> forwarded `Host` is the public one so legitimate same-origin writes aren't 403'd.

### Testing

`createTestApp()` boots the real app on an ephemeral port in-process — the full pipeline
(CSRF, cookies, base path) over its real surface, with no separate mock client. Register
the preload in `bunfig.toml`:

```toml
[test]
preload = ["@belte/belte/preload"]
```

```ts
import { test, expect } from 'bun:test'
import { createTestApp } from '@belte/belte/test/createTestApp'

test('weather', async () => {
    await using app = await createTestApp()
    const data = await app.rpc.getWeather({ city: 'SF' })
    expect(data.city).toBe('SF')
})
```

`app.rpc.*` calls verbs over HTTP, `app.sockets.*` are the live sockets, `app.fetch`
hits any route, and disposal (`await using`) stops the server and releases the port.

### Deploy

A belte process holds the `global` cache, retained socket frames, and socket fan-out in
its own memory — it is a **single-process** deploy; horizontal scale needs an external
backbone. `belte compile` builds the client and embeds it into one standalone binary, so
the image needs neither Bun nor `node_modules`:

```dockerfile
FROM oven/bun AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bunx belte compile --out belte-app

FROM debian:bookworm-slim
COPY --from=build /app/belte-app /usr/local/bin/belte-app
ENV PORT=3000
EXPOSE 3000
CMD ["belte-app"]
```

`PORT` pins the listener (unset, it scans up from 3000); `BELTE_IDLE_TIMEOUT` is Bun's
per-connection idle ceiling in seconds.

### Observability

```ts
import { health } from '@belte/belte/shared/health'
import { reachable } from '@belte/belte/shared/reachable'
import { log } from '@belte/belte/shared/log'
import { trace } from '@belte/belte/shared/trace'

const { reachable: up } = health()    // polls /__belte/health only while a scope reads it
await reachable('api.example.com')    // outbound HEAD probe — active complement to online()
log('order placed', { id })           // request-scoped, channelled, TSV or JSON
log.channel('billing').warn('retry')  // DEBUG-gated diagnostic channel
trace()                               // the request's W3C traceparent
```

Every `log` record carries the request's trace id, elapsed ms, and method+path.

### Reference

Every public name is its own module path under one of three import namespaces:
`@belte/belte/server/*` (server-only), `@belte/belte/browser/*` (client-only), and
`@belte/belte/shared/*` (isomorphic — the same callable both sides, e.g. `cache`,
`HttpError`, `url`). There is no umbrella entry, so importing one name never drags in
its siblings.

A project:

```text
src/
  app.ts                  optional hooks: init / handle / health / …
  server/
    config.ts             env(schema), validated at boot
    rpc/<name>.ts         one verb export per file → /rpc/<name>
    sockets/<name>.ts     one socket export per file
    prompts/<name>.ts     MCP prompt templates
  browser/
    pages/                page.svelte / layout.svelte / error.svelte
    public/               static assets, served at the site root
  mcp/
    resources/            MCP resource files
```

| Command | Does |
| --- | --- |
| `belte scaffold <name>` | scaffold a project, install, start dev |
| `belte dev` | build + serve with hot reload |
| `belte build` | build the client into `dist/_app/` |
| `belte start` | run the production server against `dist/` |
| `belte run <file>` | run a script under the belte preload |
| `belte compile` | build a standalone server binary |
| `belte cli` | build the thin CLI binary |
| `belte bundle` | build a desktop app bundle |

| Route | Serves |
| --- | --- |
| `/__belte/health` | reachability + `app.health()` fields + framework identity |
| `/__belte/identity` | identity-only alias of the health payload |
| `/__belte/mcp` | the JSON-RPC MCP endpoint |
| `/__belte/sockets` | the multiplexed socket connection |
| `/__belte/cli` | the platform-detecting CLI install script |
| `/__belte/inspector` | the opt-in inspector (`BELTE_ENABLE_INSPECTOR`) |
| `/openapi.json` | the OpenAPI spec for the rpc surface |

| Env var | Controls |
| --- | --- |
| `PORT` | listener port (unset → scan up from 3000) |
| `APP_URL` | public origin; its pathname becomes the mount base |
| `BELTE_IDLE_TIMEOUT` | Bun per-connection idle ceiling, seconds |
| `BELTE_MAX_REQUEST_BODY_SIZE` | server-wide request body ceiling, bytes |
| `BELTE_CLIENT_TIMEOUT` | client fetch wait before giving up, ms |
| `BELTE_REACHABLE_INTERVAL` / `BELTE_REACHABLE_TIMEOUT` | `reachable()` poll cadence / per-probe bound, ms |
| `BELTE_LOG_FORMAT` | `json` for one object per line (default TSV) |
| `BELTE_DATA_DIR` | override the bundle's per-user data directory |
| `BELTE_ENABLE_INSPECTOR` / `BELTE_INSPECT` | mount the inspector / enable webview devtools |
| `BELTE_APP_URL` / `BELTE_APP_TOKEN` | remote server + bearer token baked into the CLI binary |
| `DEBUG` | `-belte` silences belte's request log and boot map |

MIT
