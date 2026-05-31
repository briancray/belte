import { findVerbByCommandName } from '../server/rpc/findVerbByCommandName.ts'
import type { HttpVerb } from '../server/rpc/types/HttpVerb.ts'
import { verbRegistry } from '../server/rpc/verbRegistry.ts'
import { buildRpcRequest } from '../shared/buildRpcRequest.ts'
import { decodeResponse } from '../shared/decodeResponse.ts'
import type { CliManifest } from './types/CliManifest.ts'

/*
Each property of the client is a callable: invoking it decodes the body
(plain call), while `.raw(args)` returns the underlying Response without
decoding or throwing on non-2xx — the escape hatch the CLI uses to sniff
the Content-Type and stream sse/jsonl bodies frame-by-frame instead of
buffering through decodeResponse.
*/
type ClientInvoker = ((args?: unknown) => Promise<unknown>) & {
    raw: (args?: unknown) => Promise<Response>
}

type AnyApi = Record<string, ClientInvoker>

// A command resolved to its HTTP shape — the manifest/registry lookup result.
type ResolvedCommand = { method: HttpVerb; url: string; accept?: string }

/*
Builds a typed proxy over the project's RPCs for use in scripts, tests,
server-to-server calls, and the standalone CLI binary. Modes are
decided at construction:

  - With `url`: remote-mode. Each property access becomes an HTTP call
    against `<url>/<manifest[name].url>` using the manifest's method.
    Auth header is set from `token` when provided.
  - Without `url`: in-process mode. Each property access looks up the
    verb in the registry (populated by importing the project's rpc
    modules) and calls `verb.fetch(synthesizedRequest)` — same code
    path the HTTP router uses, no network hop.

The `manifest` is the bundler-emitted CLI manifest baked into the thin
binary. In in-process mode it's optional (registry is the source of
truth); in remote mode it supplies the method + url per command without
needing the rpc modules loaded. The mode is chosen solely by whether
`url` is set — the shipped CLI binary (see runCli) always passes `url`,
so it runs remote-only; in-process mode is for same-project scripts and
tests that import this directly without a `url`.
*/
export function createClient<Api extends AnyApi = AnyApi>(opts?: {
    url?: string
    token?: string
    manifest?: CliManifest
}): Api {
    const url = opts?.url
    const token = opts?.token
    const manifest = opts?.manifest

    /*
    Look up method + url for a given name. Manifest wins (the binary's
    baked-in source of truth); registry is the in-process fallback for
    use in same-project code where defineVerb has run.
    */
    function resolve(name: string): ResolvedCommand | undefined {
        const entry = manifest?.[name]
        if (entry) {
            return { method: entry.method, url: entry.url, accept: entry.accept }
        }
        const found = findVerbByCommandName(name)
        return found ? { method: found.remote.method, url: found.remote.url } : undefined
    }

    /*
    Single dispatch path for both modes — only the base URL and how the
    Request is sent differ. Remote mode fetches over the network;
    in-process mode looks the verb up in the registry and runs verb.fetch
    (no hop). Returns the raw Response; callers decode or stream it.
    */
    function send(
        resolved: ResolvedCommand,
        args: unknown,
        baseUrl: string,
        dispatch: (request: Request) => Promise<Response>,
    ): Promise<Response> {
        const headers = new Headers()
        if (token) {
            headers.set('authorization', `Bearer ${token}`)
        }
        if (resolved.accept) {
            headers.set('accept', resolved.accept)
        }
        const request = buildRpcRequest({
            method: resolved.method,
            url: resolved.url,
            args,
            baseUrl,
            headers,
        })
        return dispatch(request)
    }

    // Decoding plain-call path: throws on non-2xx, returns the decoded body.
    async function call(
        resolved: ResolvedCommand,
        args: unknown,
        baseUrl: string,
        dispatch: (request: Request) => Promise<Response>,
    ): Promise<unknown> {
        const response = await send(resolved, args, baseUrl, dispatch)
        if (!response.ok) {
            throw new Error(
                `${resolved.method} ${resolved.url} failed: ${response.status} ${response.statusText}`,
            )
        }
        return decodeResponse(response)
    }

    // In-process dispatch: resolve the verb from the registry and run its fetch.
    function inProcessDispatch(path: string): (request: Request) => Promise<Response> {
        return (request) => {
            const entry = verbRegistry.get(path)
            if (!entry) {
                throw new Error(
                    `RPC ${path} not loaded — import the module first or set APP_URL to use remote mode`,
                )
            }
            return entry.remote.fetch(request)
        }
    }

    /*
    Memoise per-name so repeated `client.foo` accesses skip both the
    registry scan in resolve() and a fresh closure allocation. The
    manifest + registry are fixed for a client's lifetime, so a resolved
    invoker (or its absence) never changes.
    */
    const invokerCache = new Map<string, ClientInvoker | undefined>()

    /*
    Build a memoised invoker for a resolved command. The plain call and
    `.raw` share one dispatch — remote mode hits the network, in-process
    mode runs verb.fetch — so the two can't diverge on URL/headers.
    */
    function buildInvoker(resolved: ResolvedCommand): ClientInvoker {
        const baseUrl = url ?? 'http://localhost/'
        const dispatch = url ? fetch : inProcessDispatch(resolved.url)
        const invoker = ((args?: unknown) =>
            call(resolved, args, baseUrl, dispatch)) as ClientInvoker
        invoker.raw = (args?: unknown) => send(resolved, args, baseUrl, dispatch)
        return invoker
    }

    return new Proxy({} as Api, {
        get(_target, prop): ClientInvoker | undefined {
            if (typeof prop !== 'string') {
                return undefined
            }
            if (invokerCache.has(prop)) {
                return invokerCache.get(prop)
            }
            const resolved = resolve(prop)
            const invoker = resolved ? buildInvoker(resolved) : undefined
            invokerCache.set(prop, invoker)
            return invoker
        },
    })
}
