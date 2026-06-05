import type { RawRemoteFunction } from '../server/rpc/types/RawRemoteFunction.ts'
import type { RemoteFunction } from '../server/rpc/types/RemoteFunction.ts'
import { activeCacheStore } from '../shared/activeCacheStore.ts'
import { canonicalJson } from '../shared/canonicalJson.ts'
import { decodeResponse } from '../shared/decodeResponse.ts'
import { getRemoteMeta } from '../shared/getRemoteMeta.ts'
import { keyForRemoteCall } from '../shared/keyForRemoteCall.ts'
import type { CacheEntry } from '../shared/types/CacheEntry.ts'
import type { CacheOptions } from '../shared/types/CacheOptions.ts'
import type { CacheStore } from '../shared/types/CacheStore.ts'

type AnyRemote<Args, Return> = RemoteFunction<Args, Return> | RawRemoteFunction<Args>

/*
Curries a remote-function call against the request-scoped cache store.
`cache(fn, options?)` returns an invoker; calling that invoker with args
checks the store for a prior entry (keyed by fn.method + fn.url + args) and
returns a shared promise on hit, or invokes the underlying raw call once
and stores the resulting Response promise on miss. Splitting configuration
(the outer call) from invocation (the inner call) keeps options anchored
in a fixed position so they can't collide with arg shapes. TTL = undefined
→ forever; ttl = 0 → dedupe only; ttl > 0 → entry expires `ttl` ms after
the promise resolves.

The invoker's return type mirrors the function you passed:

  cache(getPost)({ id })       // → Promise<Post>      (decoded body)
  cache(getPost.raw)({ id })   // → Promise<Response>  (raw escape hatch)

Both share one stored entry — the cache only ever holds the underlying
Response promise; the decoded view is derived on the way out for callers
of the non-raw variant.

Reactivity is implicit: the invoker calls `store.subscribe(key)`, which
registers the surrounding $derived / $effect scope. Invalidating the key
then re-runs that scope, which calls cache() again and gets a fresh entry.
Outside a tracking scope subscribe() is a no-op, so cache() works the same
in server code and plain client code.

SSR: how you consume the call decides inline vs streaming, per Svelte's
documented {#await} rule (only the pending branch renders during SSR):

  const post = await cache(getPost)({ id })   // blocks render → baked into
                                              // the initial SSR HTML
  {#await cache(getPost)({ id })}             // renders pending → shell flushes
                                              // now, value streams in on the
                                              // same response when it resolves

The two don't mix within one component. A top-level `await` flips Svelte's
async render into await-everything mode and sweeps in every promise created
in that same component instance — so a sibling {#await} (or a
<svelte:boundary pending>) gets awaited and inlined too, buffering the whole
response to the slowest read. The markup form doesn't change this: a boundary
renders its pending branch but render() still blocks. To get both on one page,
isolate each blocking (top-level await) read in its own child component and
keep streaming reads in a parent that never top-level awaits — the
await-everything mode is per component instance, so a child's await blocks only
the child.
*/
export function cache<Args, Return>(
    fn: RemoteFunction<Args, Return>,
    options?: CacheOptions,
): (args?: Args) => Promise<Return>
export function cache<Args>(
    fn: RawRemoteFunction<Args>,
    options?: CacheOptions,
): (args?: Args) => Promise<Response>
export function cache<Args, Return>(
    fn: AnyRemote<Args, Return>,
    options?: CacheOptions,
): (args?: Args) => Promise<Return | Response> | Return {
    /*
    The "raw" variant lacks its own `.raw` sibling; only the decoded
    callable carries one. Tell them apart by that presence and dispatch the
    decode step accordingly.
    */
    const isRaw = !('raw' in fn)
    const rawFn = isRaw ? (fn as RawRemoteFunction<Args>) : (fn as RemoteFunction<Args, Return>).raw
    return (args) => {
        const store = activeCacheStore()
        const key = resolveKey(rawFn, args, options?.key)
        store.subscribe(key)
        const existing = store.entries.get(key)
        /*
        Tag an existing entry with this call's scope so a later
        cache.invalidate({ scope }) reaches entries hydrated from the SSR
        snapshot (which carry a value but no scope) without a refetch. Merge
        rather than replace so a read tagging one group can't drop tags a
        different read site already added.
        */
        if (existing && options?.scope !== undefined) {
            existing.scope = mergeScopes(existing.scope, options.scope)
        }
        /*
        Snapshot warm path: hydration pre-decoded the SSR body onto the
        entry, so the decoded variant returns it synchronously — the first
        {#await} render resolves without a microtask suspension and matches
        the SSR DOM. Raw callers always take the Response path. After an
        invalidate the replacement entry carries no value and falls through
        to the async fetch as before.

        The public overload stays typed Promise<Return> on purpose: a
        non-thenable is the only thing {#await} can render synchronously, so
        the sync return is left as an internal optimization rather than
        widened to `Return | Promise<Return>` (which would leak it into every
        caller's types). The one cost is that `.then`/`.catch`/`.finally`
        directly on a warm result throws — consume cache via `await`/`{#await}`,
        never `.then`. Don't "fix" the type; see memory cache-warm-sync-tradeoff.
        */
        if (!isRaw && existing?.value !== undefined) {
            return existing.value as Return
        }
        const responsePromise = invokeWithCache(store, key, existing, rawFn, args, options)
        return isRaw ? responsePromise : (responsePromise.then(decodeResponse) as Promise<Return>)
    }
}

function invokeWithCache<Args>(
    store: ReturnType<typeof activeCacheStore>,
    key: string,
    existing: CacheEntry | undefined,
    rawFn: RawRemoteFunction<Args>,
    args: Args | undefined,
    options: CacheOptions | undefined,
): Promise<Response> {
    if (existing) {
        return shareable(existing.promise)
    }
    const promise = rawFn(args as Args)
    const request = getRemoteMeta(promise)
    if (!request) {
        throw new Error(
            '[belte] cache() received a function whose call did not record metadata — was it produced by a verb helper?',
        )
    }
    const ttl = options?.ttl
    const entry: CacheEntry = {
        key,
        promise,
        request,
        ttl,
        expiresAt: undefined as number | undefined,
        scope: options?.scope === undefined ? undefined : toScopeSet(options.scope),
    }
    store.entries.set(key, entry)
    markLifecycle(store)
    function deleteIfCurrent() {
        if (store.entries.get(key) === entry) {
            store.entries.delete(key)
            markLifecycle(store)
        }
    }
    promise.then(() => {
        /*
            Mark settled so SSR snapshot serialization can tell awaited entries
            (resolved by the time render() returns → inline) from {#await} ones
            (still pending → stream). Set before the ttl branches below since a
            ttl=0 server entry stays in the store for the snapshot.
            */
        entry.settled = true
        markLifecycle(store)
        /*
            On the server the cache store is request-scoped and gets GC'd
            with the response; skip ttl=0 eviction so the SSR snapshot can
            still pick the entry up. In the browser ttl=0 stays "dedupe
            in-flight only" — evict the moment the promise settles.
            */
        if (ttl === 0) {
            if (typeof window !== 'undefined') {
                deleteIfCurrent()
            }
            return
        }
        if (ttl !== undefined) {
            entry.expiresAt = Date.now() + ttl
            setTimeout(() => {
                if ((entry.expiresAt ?? 0) <= Date.now()) {
                    deleteIfCurrent()
                }
            }, ttl).unref?.()
        }
    }, deleteIfCurrent)
    return shareable(promise)
}

/*
Returns a promise that resolves to a fresh clone of the underlying Response.
Multiple readers can each consume the body independently — the stored
promise's Response is never consumed directly, so clones always succeed.
*/
function shareable(promise: Promise<Response>): Promise<Response> {
    return promise.then((response) => response.clone())
}

type Selector<Args, Return> = AnyRemote<Args, Return> | Pick<CacheOptions, 'key' | 'scope'>

/*
Compiles a selector into an entry predicate shared by invalidate() and
pending() so both interpret the three call shapes identically:
  undefined            → every entry
  fn                   → that function's calls (method+url prefix). `arg.url` is
                         the route template; per-call args appear as `?...`
                         (GET/DELETE) or after a space (canonical-json body) —
                         see keyForRemoteCall. `fn` and `fn.raw` match the same
                         set since they share method+url.
  { key?, scope? }     → the named entry and/or any entry sharing a scope tag;
                         both fields present → the union. `key` is canonicalised
                         like the cache() option. An empty selector matches
                         nothing.
*/
function selectorMatcher<Args, Return>(
    arg?: Selector<Args, Return>,
): (entry: CacheEntry) => boolean {
    if (arg === undefined) {
        return () => true
    }
    if (typeof arg === 'function') {
        const prefix = `${arg.method} ${arg.url}`
        return (entry) =>
            entry.key === prefix ||
            entry.key.startsWith(`${prefix}?`) ||
            entry.key.startsWith(`${prefix} `)
    }
    const target = arg.key !== undefined ? canonicalKey(arg.key) : undefined
    const requestedScopes = arg.scope === undefined ? undefined : toScopeSet(arg.scope)
    return (entry) =>
        (target !== undefined && entry.key === target) ||
        (requestedScopes !== undefined &&
            entry.scope !== undefined &&
            intersects(entry.scope, requestedScopes))
}

/*
Drops every entry matching the selector (see selectorMatcher) and notifies
readers. An empty or unmatched selector is a no-op on the cache; the lifecycle
ping still fires but recomputes pending() to the same value.
*/
function invalidate<Args, Return>(arg?: Selector<Args, Return>): void {
    const store = activeCacheStore()
    const matches = selectorMatcher(arg)
    const affected = Array.from(store.entries.values())
        .filter(matches)
        .map((entry) => entry.key)
    affected.forEach((key) => store.entries.delete(key))
    emit(store, affected)
    markLifecycle(store)
}

cache.invalidate = invalidate

/*
Reactive in-flight probe sharing invalidate's selector grammar:
  pending()                  → any rpc in flight (global progress bar)
  pending(fn)                → that function's calls (per-route spinner)
  pending({ key?, scope? })  → a named entry and/or tagged group
Returns true while any matching entry's promise is unsettled. The read taps the
store's lifecycle channel, so a $derived re-runs when a matching call starts or
settles. Outside a tracking scope (plain client code, SSR) the tap is a no-op
and it returns the current value — SSR loading state is driven by {#await}, not
this.
*/
function pending<Args, Return>(arg?: Selector<Args, Return>): boolean {
    const store = activeCacheStore()
    store.trackLifecycle()
    const matches = selectorMatcher(arg)
    return Array.from(store.entries.values()).some(
        (entry) => entry.settled !== true && matches(entry),
    )
}

cache.pending = pending

/* Signals cache.pending readers that in-flight membership changed. */
function markLifecycle(store: CacheStore): void {
    store.events.dispatchEvent(new Event('lifecycle'))
}

function resolveKey<Args>(
    rawFn: RawRemoteFunction<Args>,
    args: Args | undefined,
    override: CacheOptions['key'],
): string {
    if (override !== undefined) {
        return canonicalKey(override)
    }
    return keyForRemoteCall(rawFn.method, rawFn.url, args)
}

function canonicalKey(value: CacheOptions['key']): string {
    if (typeof value === 'string') {
        return value
    }
    return canonicalJson(value)
}

/* Normalizes a scope option (one tag or many) to a Set for O(1) membership. */
function toScopeSet(scope: string | string[]): Set<string> {
    return new Set(typeof scope === 'string' ? [scope] : scope)
}

/* Folds new tags into an entry's existing set without duplicating them. */
function mergeScopes(existing: Set<string> | undefined, incoming: string | string[]): Set<string> {
    return new Set([...(existing ?? []), ...toScopeSet(incoming)])
}

/* True when an entry's tags and the requested tags overlap on any tag. */
function intersects(entryScopes: Set<string>, requestedScopes: Set<string>): boolean {
    return Array.from(requestedScopes).some((scope) => entryScopes.has(scope))
}

/*
Detail is a Set so each subscriber's `has(key)` check is O(1) regardless of
how many keys a single invalidate touches.
*/
function emit(store: ReturnType<typeof activeCacheStore>, keys: string[]): void {
    if (keys.length === 0) {
        return
    }
    store.events.dispatchEvent(new CustomEvent('invalidate', { detail: new Set(keys) }))
}
