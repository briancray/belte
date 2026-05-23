import { keyForRemoteCall } from '../shared/keyForRemoteCall.ts'
import { recordRemoteMeta } from '../shared/remoteMeta.ts'
import type { HttpVerb } from '../types/HttpVerb.ts'
import type { RemoteFunction } from '../types/RemoteFunction.ts'
import type { RemoteResponse } from '../types/RemoteResponse.ts'

/*
Client-side substitute for a verb-defined endpoint handler. The bundler
generates one call per export in an endpoint.ts module: server target uses
defineVerb (real handler), browser target uses remoteProxy (fetch over the
network). Both paths produce identical RemoteFunction shapes and identical
WeakMap metadata so cache() works the same on either side.
*/
export function remoteProxy<Args, Return>(
    method: HttpVerb,
    route: string,
): RemoteFunction<Args, Return> {
    function buildRequest(args: Args | undefined): Request {
        if (method === 'GET' || method === 'DELETE') {
            const searchParams =
                args && typeof args === 'object'
                    ? new URLSearchParams(args as Record<string, string>)
                    : undefined
            const target =
                searchParams && searchParams.toString().length > 0
                    ? `${route}?${searchParams.toString()}`
                    : route
            return new Request(toAbsolute(target), { method })
        }
        if (args === undefined) {
            return new Request(toAbsolute(route), { method })
        }
        return new Request(toAbsolute(route), {
            method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(args),
        })
    }

    function dispatch(request: Request, args: Args | undefined): Promise<RemoteResponse<Return>> {
        const promise = fetch(request) as Promise<RemoteResponse<Return>>
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
        return dispatch(request, args)
    }

    callable.method = method
    callable.url = route
    callable.fetch = (request: Request): Promise<RemoteResponse<Return>> => {
        return dispatch(request, undefined)
    }
    return callable as RemoteFunction<Args, Return>
}

function toAbsolute(path: string): string {
    if (typeof window !== 'undefined') {
        return new URL(path, window.location.href).href
    }
    return path
}
