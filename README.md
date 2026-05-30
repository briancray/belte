# Belte

Isomorphic multimodal HTTP framework built for humans and machines in a single Bun runtime.

Declare a handler once. Belte exposes it to every client — web, CLI, MCP, and a native bundle — from one Bun process, with the same name and the same behavior on both sides of the wire.

| Audience | Surfaces                         |
| -------- | -------------------------------- |
| Humans   | web (Svelte), CLI, native bundle |
| Machines | MCP, CLI                         |

The CLI serves both: humans run it by hand, machines script it.

## Try it

The fastest path is a prebuilt example or the scaffold.

```sh
# scaffold a new app
bunx @briancray/belte scaffold my-app
cd my-app && bun install && bun dev
```

```sh
# kitchen-sink: every feature in one app
git clone https://github.com/briancray/belte
cd belte/examples/kitchen-sink && bun dev
```

## What is an isomorphic multimodal framework

- **One runtime.** Dev and production run the same code paths on Bun. No separate adapter per target.
- **Declare once, use anywhere.** A handler declared on the server is callable — for free — over HTTP from the browser, as an MCP tool, as a CLI command, and from inside the native bundle.
- **The bundler swaps the runtime.** The verb helper you call is rewritten per build target: it keeps the implementation on the server and becomes a typed remote call on the client.

Declare a handler in `src/server/rpc/users.ts` — one export per file, named after the file:

```ts
import { GET } from "@briancray/belte/server/GET";
import { json } from "@briancray/belte/server/json";

export const users = GET(({ id }: { id: string }) => json(db.users.find(id)));
```

Consume the same export on each client:

```ts
// browser — the bundler swaps in a fetch
import { users } from "$server/rpc/users";
const user = await users({ id: "42" });
```

```sh
# CLI — generated command, flags from the schema
my-app users --id 42
```

```
# MCP — exposed as a tool named "users", called by the model
```

## Server

### Server / RPC

#### Declaring

A verb factory turns a handler into a remote function. The same factory exists for every method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`. Each lives at its own path (`@briancray/belte/server/GET`, …) and is the single export of a file under `src/server/rpc/`, named after the file.

```ts
type VerbHelper = {
  // with a schema — Args is inferred from the schema, Return overridable
  <Return, Schema>(
    handler: (args: InferOutput<Schema>) => Response,
    opts: { schema: Schema; clients?: Partial<ClientFlags> }
  ): RemoteFunction<InferInput<Schema>, Return>;
  // bare handler — Args and Return come from the handler
  <Args, Return>(handler: (args: Args) => Response): RemoteFunction<
    Args,
    Return
  >;
};
```

| Argument       | Type                                            | Purpose                                                                                                                                             |
| -------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handler`      | `(args: Args) => Response \| Promise<Response>` | The implementation. Receives one parsed argument bag and returns a `Response` — use a [response helper](#response-helpers) so `Return` is inferred. |
| `opts.schema`  | Standard Schema                                 | Validates the argument bag before the handler; infers `Args`; feeds the OpenAPI and MCP input schema.                                               |
| `opts.clients` | `Partial<ClientFlags>`                          | Which surfaces (`browser` / `mcp` / `cli`) expose the route. Defaults to all.                                                                       |

The argument bag is one object: query parameters for `GET`/`DELETE`, the parsed JSON or form body otherwise. For binary or multipart bodies it is `undefined` — read the raw request with [`request()`](#request-and-server). Schemas follow [Standard Schema](https://standardschema.dev), so zod, valibot, and arktype are interchangeable.

```ts
import { POST } from "@briancray/belte/server/POST";
import { json } from "@briancray/belte/server/json";
import { z } from "zod";

export const createPost = POST(
  ({ title, body }) => json(db.posts.create({ title, body })),
  {
    schema: z.object({ title: z.string(), body: z.string() }),
  }
);
```

##### Response helpers

A handler must return a `Response`. These helpers build the common ones; each carries a type brand so the verb infers `Return` from the handler body. All are server-only modules under `@briancray/belte/server/`.

| Helper     | Type                                                                               | Use                                                                 |
| ---------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `json`     | `<T>(data: T, init?: ResponseInit) => Response`                                    | JSON body; sets `Cache-Control: no-store` unless overridden.        |
| `jsonl`    | `<T>(source: AsyncIterable<T>, init?: ResponseInit) => Response`                   | Stream one JSON value per line (NDJSON).                            |
| `sse`      | `<T>(source: AsyncIterable<T>, init?: ResponseInit) => Response`                   | Stream as `text/event-stream` with a 15s keepalive.                 |
| `redirect` | `(url: string, status?: 301\|302\|303\|307\|308, init?: ResponseInit) => Response` | Redirect; accepts relative URLs, defaults to `302`.                 |
| `error`    | `(status: number, message?: string, init?: ResponseInit) => Response`              | Plain-text error response; `message` defaults to the status reason. |

```ts
export const report = GET(() => json({ ok: true }, { status: 201 }));
```

To short-circuit by throwing instead of returning, `throw new HttpError(error(404, "not found"))`; the `handleError` hook catches it.

##### request() and server()

Both resolve from the in-flight request context (an `AsyncLocalStorage`); both throw if called outside a request / before boot rather than returning `undefined`.

```ts
type request = () => Request;
type server = () => Bun.Server;
```

| Function    | Returns                  | Use inside a handler for                        |
| ----------- | ------------------------ | ----------------------------------------------- |
| `request()` | the in-flight `Request`  | headers, cookies, `request.signal`, the raw URL |
| `server()`  | the running `Bun.Server` | upgrades and low-level server access            |

```ts
import { request } from "@briancray/belte/server/request";

export const whoami = GET(() => json(request().headers.get("authorization")));
```

#### Consuming

The verb factory returns a `RemoteFunction`. On the client it is the same callable; the bundler routes the call over HTTP to `/rpc/<name>`.

```ts
type RemoteFunction<Args, Return> = ((args: Args) => Promise<Return>) & {
  raw: (args: Args) => Promise<Response>;
  stream: (args?: Args) => Subscribable<Return>;
  method: string;
  url: string;
};
```

The argument bag is encoded into the request — query parameters for `GET`/`DELETE`, a JSON body otherwise — and the response body is decoded (by `Content-Type`) back into `Return`.

```ts
const user = await users({ id: "42" }); // typed Return
```

##### `.raw`

Returns the underlying `Response` without decoding and without throwing on non-2xx — for headers, status, or non-JSON payloads.

```ts
const response = await report.raw();
const etag = response.headers.get("etag");
```

##### `.stream`

Returns a `Subscribable<Return>` over the response frames — an `AsyncIterable` usable directly or through [`subscribe`](#subscribe). `sse`/`jsonl` handlers yield each frame; non-streaming handlers yield their value once.

```ts
for await (const line of logs.stream({ since })) {
  console.log(line);
}
```

##### Errors

A non-2xx response rejects with an `HttpError` carrying the status and raw `Response`, so client and server observe the same failure. Importable from `@briancray/belte/browser/HttpError`.

```ts
class HttpError extends Error {
  status: number;
  statusText: string;
  response: Response;
}
```

```ts
try {
  await users({ id: "missing" });
} catch (error) {
  // error.status, await error.response.text()
}
```

##### openapi.json

Each RPC's method, `url`, and `schema` feed a generated OpenAPI document served at `/openapi.json` (also `/swagger.json`) for external tooling.

### Server / sockets

#### Declaring

`socket` declares a named broadcast channel, the single export of a file under `src/server/sockets/`. The export name and file path become the socket name.

```ts
type socket = {
  <Schema>(opts: SocketOptions & { schema: Schema }): Socket<
    InferOutput<Schema>
  >;
  <T>(opts?: SocketOptions): Socket<T>;
};
```

| Field           | Type                   | Default      | Purpose                                                                                       |
| --------------- | ---------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| `schema`        | Standard Schema        | —            | Validates each published payload, infers `T`, and describes the payload to MCP/CLI.           |
| `history`       | `number`               | `0`          | Recent payloads retained and replayed to each new subscriber.                                 |
| `ttl`           | `number`               | —            | Drop history entries older than this many ms before replay.                                   |
| `clientPublish` | `boolean`              | `false`      | Allow clients to publish (fan-out chat style). Server-only topics ignore client `pub` frames. |
| `clients`       | `Partial<ClientFlags>` | browser-only | Which non-browser surfaces (`mcp` / `cli`) advertise the socket.                              |

```ts
import { socket } from "@briancray/belte/server/socket";
import { z } from "zod";

export const chat = socket({
  schema: z.object({ from: z.string(), text: z.string() }),
  history: 50,
  clientPublish: true,
});
```

#### Publishing

`publish` is isomorphic: server code publishes in-process and fans out to remote subscribers.

```ts
interface Socket<T> extends AsyncIterable<T> {
  name: string;
  publish(message: T): void;
  tail(count?: number): AsyncIterable<T>;
}
```

```ts
import { chat } from "$server/sockets/chat";

export const announce = POST(({ text }) => {
  chat.publish({ from: "system", text });
  return json({ ok: true });
});
```

#### Consuming

A `Socket<T>` is an `AsyncIterable<T>` — iterating opens a subscription, replaying history first when configured. `.tail(count)` replays the last `count` payloads, then tails live. Both satisfy `Subscribable`, so a socket can also be passed to [`subscribe`](#subscribe) for a reactive latest value.

```ts
for await (const message of chat) {
  render(message);
}

for await (const message of chat.tail(20)) {
  render(message);
}
```

## Clients

### Browser

#### Pages

Pages live under `src/browser/pages/` and are folder-based: each route folder holds a `page.svelte`, and the URL is the folder path. Dynamic segments use bracket folders.

| Folder                              | Route                               |
| ----------------------------------- | ----------------------------------- |
| `pages/page.svelte`                 | `/`                                 |
| `pages/about/page.svelte`           | `/about`                            |
| `pages/users/[id]/page.svelte`      | `/users/:id`                        |
| `pages/files/[...rest]/page.svelte` | catch-all                           |
| `pages/(group)/…`                   | group folder, stripped from the URL |

```svelte
<!-- src/browser/pages/users/[id]/page.svelte -->
<script lang="ts">
  import { page } from "@briancray/belte/browser/page";
  import { users } from "$server/rpc/users";
  const user = await users({ id: page.params.id });
</script>

<h1>{user.name}</h1>
```

#### Layouts

A `layout.svelte` in a route folder wraps that folder and everything beneath it, rendering its children. Nest layouts by placing one per level.

```svelte
<!-- src/browser/pages/layout.svelte -->
<script lang="ts">
  let { children } = $props();
</script>

<nav>…</nav>
{@render children()}
```

#### cache

`cache` wraps a remote function in a reactive, read-through cache. It returns an invoker; calling it dedupes concurrent calls with the same key and shares one in-flight request. Reading the result inside `$derived`/`$effect` subscribes the scope, so invalidation re-runs it.

```ts
type cache = {
  <Args, Return>(fn: RemoteFunction<Args, Return>, options?: CacheOptions): (
    args?: Args
  ) => Promise<Return>;
  <Args>(fn: RawRemoteFunction<Args>, options?: CacheOptions): (
    args?: Args
  ) => Promise<Response>;
};
```

| Option | Type                                             | Effect                                                                                                         |
| ------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `key`  | `string \| unknown[] \| Record<string, unknown>` | Stable identity; strings used verbatim, other values canonicalised. Omit to derive from method + url + args.   |
| `ttl`  | `number`                                         | `undefined` → cache until invalidated; `0` → in-flight dedupe only; `> 0` → expire that many ms after resolve. |

`cache.invalidate(fn | key)` clears matching entries; omit the argument to clear all.

```svelte
<script lang="ts">
  import { cache } from "@briancray/belte/browser/cache";
  import { users } from "$server/rpc/users";
  const user = $derived(await cache(users)({ id: "42" }));
</script>
```

#### subscribe

`subscribe` is the reactive reader for any `Subscribable<T>` — a `Socket<T>` or the result of `fn.stream(args)`. It returns the latest value; the stream opens on the first read in a tracking scope and closes when the last reader stops. Readers of the same source share one connection.

```ts
type subscribe = <T>(subscribable: Subscribable<T>) => T | undefined;
```

| Member                | Returns                                    | Meaning                                                |
| --------------------- | ------------------------------------------ | ------------------------------------------------------ |
| `subscribe(s)`        | `T \| undefined`                           | Latest payload, or `undefined` before the first frame. |
| `subscribe.error(s)`  | `Error \| undefined`                       | Last error surfaced by the stream.                     |
| `subscribe.status(s)` | `'pending' \| 'open' \| 'done' \| 'error'` | Stream lifecycle state.                                |

`subscribe` is a no-op during SSR (returns `undefined`); seed initial HTML with `cache`, then layer `subscribe` on top after hydration.

```svelte
<script lang="ts">
  import { subscribe } from "@briancray/belte/browser/subscribe";
  import { chat } from "$server/sockets/chat";
  const latest = $derived(subscribe(chat));
</script>

<p>{latest?.text}</p>
```

#### navigate

Client-side navigation. Pushes history and swaps the route component without a full reload; falls back to a hard navigation on failure.

```ts
type navigate = (
  href: string,
  options?: { replace?: boolean; scroll?: boolean }
) => Promise<void>;
```

```ts
import { navigate } from "@briancray/belte/browser/navigate";
await navigate("/users/42");
```

#### Page state

`page` is reactive state for the current route. Narrowing on `page.route` narrows `page.params`.

| Field    | Type                     | Meaning                                        |
| -------- | ------------------------ | ---------------------------------------------- |
| `route`  | `string`                 | Matched route path.                            |
| `params` | `Record<string, string>` | Path parameters.                               |
| `url`    | `URL`                    | Live location; reassigned on every navigation. |

### MCP

Every RPC, prompt, and resource is exposed over MCP automatically, served at `/__belte/mcp`.

- **RPCs are tools.** The route name is the tool name; the verb's `schema` becomes the tool input schema.
- **`src/mcp/prompts/*.md` are prompts.** Front matter sets the description and arguments; the body is the template, with `{{name}}` placeholders filled from the call arguments.

```md
---
description: Review a diff
arguments:
  - name: diff
    required: true
---

Review this diff:

{{diff}}
```

- **`src/mcp/resources/` are resources.** Every file is served as an MCP resource at `belte://resources/<path>`, with its MIME type inferred from the extension (text inline, binary as base64).

### CLI

Every app gets a CLI for free. RPCs become subcommands; flags are derived from each route's schema, and `<cmd> --help` lists them.

```sh
my-app users --id 42
my-app create-post --title "Hello" --body "World"
```

The CLI is a thin remote client — it always talks to a running server.

| Variable    | Required | Purpose                                                |
| ----------- | -------- | ------------------------------------------------------ |
| `APP_URL`   | yes      | Base URL the CLI calls (e.g. `http://localhost:3000`). |
| `APP_TOKEN` | no       | Sent as `Authorization: Bearer <value>`.               |

- **Output.** A string result is printed verbatim; anything else is printed as formatted JSON.
- **Distribution.** The running server hosts its own CLI binary and an install script; authenticated servers gate the download behind `APP_TOKEN`.
- **Branding.** `src/cli/banner.txt` prints atop the top-level help and `src/cli/footer.txt` below it.

### Bundle

A movable, self-contained native desktop app for the host platform, rendered in a native webview. It can serve the app itself or connect to a remote server; the built-in File menu switches between Start server, Connect, and Disconnect.

Window configuration is the default export of an optional `src/bundle/window.ts`.

```ts
type BundleWindow = {
  title?: string;
  width?: number;
  height?: number;
  menu?: BundleMenu[];
};
```

| Surface      | Type                                              | Purpose                                                                     |
| ------------ | ------------------------------------------------- | --------------------------------------------------------------------------- |
| `window.ts`  | `BundleWindow`                                    | Title, size, and custom menus (inserted between the Edit and Window menus). |
| `BundleMenu` | `{ label: string; items: BundleMenuItem[] }`      | A custom top-level menu; items emit `belte:menu` events.                    |
| `onMenu`     | `(handler: (name: string) => void) => () => void` | Subscribes to menu selections. From `@briancray/belte/bundle/onMenu`.       |

```ts
import { onMenu } from "@briancray/belte/bundle/onMenu";
onMenu((name) => {
  if (name === "preferences") openSettings();
});
```

- **`src/bundle/disconnected.svelte`** overrides the screen shown when a bundle pointed at a remote server loses its connection.
- **`src/bundle/icon.png`** (or `icon.icns`) becomes the app icon.

## Some details

### App hooks

Export any of these from `src/app.ts`; the server wires whichever are present, and defaults apply otherwise.

| Hook          | Signature                                            | Runs                                                                                 |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `init`        | `({ server }) => void \| (() => void) \| Promise<…>` | Once after boot. May return a cleanup function, run on `SIGINT`/`SIGTERM`.           |
| `handle`      | `(request, next) => Response \| Promise<Response>`   | Around every request. Return a `Response` to short-circuit, or call `next(request)`. |
| `handleError` | `(error, request) => Response \| Promise<Response>`  | When a handler throws.                                                               |

```ts
// src/app.ts
export const handle = async (
  request: Request,
  next: (req: Request) => Promise<Response>
) => {
  const started = performance.now();
  const response = await next(request);
  console.log(request.url, performance.now() - started);
  return response;
};
```

### Project layout

```
my-app/
  src/
    app.ts                  optional init / handle / handleError hooks
    server/
      rpc/                  one verb handler per file → /rpc/<name>
      sockets/              one socket per file
    browser/
      pages/                folder-based page.svelte / layout.svelte
    mcp/
      prompts/              MCP prompt templates (.md)
      resources/            MCP resource files
    cli/
      banner.txt            printed above CLI help
      footer.txt            printed below CLI help
    bundle/
      window.ts             native window + menus
      disconnected.svelte   offline screen override
      icon.png              app icon
  public/                   static assets served at the root
```

Each surface can hold a `lib/` folder for code it shares.

### CLI commands

| Command                 | Action                                                      |
| ----------------------- | ----------------------------------------------------------- |
| `belte dev`             | Start the dev server with reload.                           |
| `belte build`           | Build the production server and client assets into `dist/`. |
| `belte start`           | Run the built production server.                            |
| `belte compile`         | Produce a standalone executable (and native bundle).        |
| `belte scaffold [name]` | Create a new app from the template.                         |

A built app exposes its own CLI: `<app> <rpc-name> [flags]`.

### public/ files

Files under `public/` are served as static assets from the root — `public/logo.svg` is served at `/logo.svg`. In a compiled binary they are embedded; in dev and `belte start` they are read off disk.

### Bundling

`belte build` generates the route manifest, bundles the client assets, and emits the production server. `belte compile` then produces a standalone single-file executable; with `src/bundle/` present it packages a native desktop app for the host platform.

### Environment variables

| Variable    | Default | Effect                                                                       |
| ----------- | ------- | ---------------------------------------------------------------------------- |
| `PORT`      | `3000`  | Server port.                                                                 |
| `DEBUG`     | unset   | Enables `debug` logging by scope — `belte`, `belte:*`, `*`, or a comma list. |
| `APP_URL`   | —       | Base URL the generated CLI calls (required for the CLI).                     |
| `APP_TOKEN` | —       | Bearer token the CLI sends.                                                  |

### Logging and DEBUG

`log` is a shared, structured logger used across the build pipeline and request handler — ANSI-coloured under a `[belte]` prefix. `debug` only emits when `DEBUG` enables its scope (matching the `debug` package conventions); the other levels always emit.

| Method                                 | Signature                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `info` / `warn` / `success` / `detail` | `(message: string) => void`                                                  |
| `error`                                | `(value: unknown) => void`                                                   |
| `debug`                                | `(scope: string, message: string) => void`                                   |
| `request`                              | `(method: string, path: string, status: number, durationMs: number) => void` |

```ts
import { log } from "@briancray/belte/shared/log";

log.info("ready");
log.debug("rpc", "dispatched users");
```
