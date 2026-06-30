import type { RequestStore } from './RequestStore.ts'

/*
The per-request seam every dynamic route crosses: establishes the request
scope, runs app.handle middleware around the matched handler, and opts a
streaming response out of the idle timeout. Closed over the live server in
createServer; the route registry and fetch handler receive it as this type so
they stay decoupled from how the scope is wired.
*/
export type DispatchRequest = (
    req: Request,
    pathParams: Record<string, string>,
    handler: (
        req: Request,
        pathParams: Record<string, string>,
        store: RequestStore,
    ) => Promise<Response>,
    /* Pre-parsed by the fetch fallback; routes-table callers omit it. */
    url?: URL,
) => Promise<Response>
