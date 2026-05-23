import type { HttpVerb } from '../types/HttpVerb.ts'
import { canonicalJson } from './canonicalJson.ts'

/*
Derives a cache key from a verb-defined remote function and its args. Mirrors
the URL composition used by defineVerb (server) and remoteProxy (client) so
the key matches the request both sides would actually send. GET/DELETE encode
args as a query string; POST/PUT/PATCH encode the canonical body inline. Used
by cache() to look up entries before invoking the call.
*/
export function keyForRemoteCall(method: HttpVerb, route: string, args: unknown): string {
    if (method === 'GET' || method === 'DELETE') {
        if (args && typeof args === 'object') {
            const search = new URLSearchParams(args as Record<string, string>).toString()
            if (search.length > 0) {
                return `${method} ${route}?${search}`
            }
        }
        return `${method} ${route}`
    }
    if (args === undefined) {
        return `${method} ${route}`
    }
    return `${method} ${route} ${canonicalJson(args)}`
}
