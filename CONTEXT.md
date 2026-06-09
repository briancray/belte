# Domain language

Terms the code and its discussions use exactly. One meaning per term; sharpen here when a term drifts.

## Routing & rendering

**Route**
A page URL in readable bracket form (`/post/[id]`, `/docs/[...rest]`), derived from the `page.svelte` file's directory path. Translation to Bun's `:name` / `*` pattern syntax happens only at server registration; everywhere else the bracket form is the identity.

**View**
What a resolved route mounts: a page (or error) component plus the layout wrapping it — the shape of App.svelte's `state.render` slot.

**View resolution**
Route in, view out: nearest-layout selection plus the parallel page+layout module load. Owned by `createViewResolver` (`lib/shared/createViewResolver.ts`); the server renderer, the client navigator, and the surface diagnostics are its three callers. Prefix matching rules live nowhere else.

**Nearest-only layout**
The deepest `layout.svelte` prefix that is an ancestor of the route wins; layouts never stack. Errors follow the same rule (`error.svelte` per prefix).

**Page renderer**
Matched route in, finished SSR document (or JSON view payload) out: the svelte render, the inline-vs-streaming cache partition, the `__SSR__` state tag, shell splicing, and the error.svelte fallback. Owned by `createPageRenderer` (`lib/server/runtime/createPageRenderer.ts`); the route dispatcher and the 404 path are its callers. `createServer` is wiring, not behavior.

**Match**
URL → route + decoded params. Server-side only: Bun's router matches, the catch-all param is reconstructed from the pathname. The client never matches URLs — it asks the server (`Accept: application/json`) and receives `{ route, params }`.

## Cache & streaming

**Streaming protocol**
The SSR→client agreement for pending `{#await}` reads: the document ships `__SSR__.streaming` placeholders (`StreamingPlaceholder`) plus a single-use `streamToken`; the resolve channel (`RESOLVE_STREAM_PATH`) streams one `StreamedResolution` per entry — a `CacheSnapshotEntry` to settle warm, or a `{ key, miss }` marker meaning "re-fetch live". Keys derive from the route template via `keyForRemoteCall` on both sides. The protocol's shapes live in `lib/shared/types/`; its enforcement is the round-trip contract test (`tests/streamingRoundTrip.test.ts`), which feeds the server half's real output into the browser half. Streaming-vs-inline is chosen by `await` vs `{#await}` in the component — never by an option.

## Agents

**Engine**
A provider adapter satisfying `AgentEngine`: surface + neutral conversation in, `AgentFrame` stream out. It owns its own loop. Lives in `@belte/<provider>`, never in core.

**Frame**
One provider-neutral streaming event (`text` / `tool_use` / `tool_result` / `done`). The frame contract is what all engines must agree on.

**Frame conformance**
The invariants every engine's stream must satisfy — exactly one `done`, last; every `tool_use` answered by a same-id same-name `tool_result`. Encoded once in `belte/test/assertAgentFrameConformance`; each provider package runs it against scripted provider output (`belte/test/createScriptedSurface` records tool dispatches).
