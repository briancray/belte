import { keyForRemoteCall } from '../shared/keyForRemoteCall.ts'
import { recordRemoteMeta } from '../shared/remoteMeta.ts'
import type { HttpVerb } from '../types/HttpVerb.ts'
import type { RemoteFunction } from '../types/RemoteFunction.ts'
import type { RemoteHandler } from '../types/RemoteHandler.ts'
import type { RemoteResponse } from '../types/RemoteResponse.ts'
import { parseArgs } from './parseArgs.ts'
import { requestContext } from './requestContext.ts'

/*
Headers forwarded from the inbound request onto in-process synthetic Requests
when a remote handler is invoked from server-side rendering. Lets handlers
read the caller's cookies/authorization without per-call wiring.
*/
const FORWARDED_HEADERS = [
    'cookie',
    'authorization',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-forwarded-host',
]

/*
Builds a RemoteFunction from an HTTP verb + route path + handler. The bundler
plugin rewrites `import { GET } from 'belte/route/GET'` per-importer so each
remote handler call site gets a route-bound GET that calls defineVerb with
the resolver-computed route. On the server, calling the function invokes the
handler directly with the current Request (built from the args); calling
.fetch(request) lets a caller hand in a Request and the wrapper parses args
off the content-type per the standard table.

Every call (direct, .fetch, or server-side dispatch) registers
`{key, method, url, request}` metadata against the returned promise so cache()
can derive the storage key without an explicit `key:` argument.
*/
export function defineVerb<Args, Return>(
    method: HttpVerb,
    route: string,
    handler: RemoteHandler<Args, Return>,
): RemoteFunction<Args, Return> {
    function buildRequest(args: Args | undefined): Request {
        const headers = inheritHeaders()
        if (method === 'GET' || method === 'DELETE') {
            const searchParams =
                args && typeof args === 'object'
                    ? new URLSearchParams(args as Record<string, string>)
                    : undefined
            const target =
                searchParams && searchParams.toString().length > 0
                    ? `${route}?${searchParams.toString()}`
                    : route
            return new Request(toAbsolute(target), { method, headers })
        }
        if (args === undefined) {
            return new Request(toAbsolute(route), { method, headers })
        }
        headers.set('content-type', 'application/json')
        return new Request(toAbsolute(route), {
            method,
            headers,
            body: JSON.stringify(args),
        })
    }

    /*
    Copies session-shaped headers from the inbound request onto the synthetic
    Request used for in-process invocation. Without this, an in-process call
    from SSR can't see the caller's cookies/authorization — silently
    differing from a network-shaped call from the client.
    */
    function inheritHeaders(): Headers {
        const headers = new Headers()
        const store = requestContext.getStore()
        if (!store) {
            return headers
        }
        for (const name of FORWARDED_HEADERS) {
            const value = store.req.headers.get(name)
            if (value) {
                headers.set(name, value)
            }
        }
        return headers
    }

    function invoke(request: Request, args: Args | undefined): Promise<RemoteResponse<Return>> {
        const promise = Promise.resolve(handler(args as Args, request)) as Promise<
            RemoteResponse<Return>
        >
        recordRemoteMeta(promise, {
            key: keyForRemoteCall(method, route, args),
            method,
            url: route,
            request,
        })
        return promise
    }

    function callable(args: Args): Promise<RemoteResponse<Return>> {
        const request = buildRequest(args)
        return invoke(request, args)
    }

    callable.method = method
    callable.url = route
    callable.fetch = async (request: Request): Promise<RemoteResponse<Return>> => {
        const args = (await parseArgs(method, request)) as Args | undefined
        return invoke(request, args)
    }
    return callable as RemoteFunction<Args, Return>
}

/*
Builds an absolute URL for the constructed Request. Uses the inbound origin
when called inside a request, falls back to http://localhost when called
out-of-band (e.g. boot-time priming). Absolute URLs are required by the
Request constructor; the host is not material because the handler is invoked
in-process without going over the network.
*/
function toAbsolute(path: string): string {
    const store = requestContext.getStore()
    if (store) {
        return new URL(path, store.url).href
    }
    return new URL(path, 'http://localhost').href
}
