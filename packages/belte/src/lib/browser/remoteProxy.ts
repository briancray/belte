import { browserClientFlags } from '../shared/browserClientFlags.ts'
import { buildRpcRequest } from '../shared/buildRpcRequest.ts'
import { createRemoteFunction } from '../shared/createRemoteFunction.ts'
import { HttpError } from '../shared/HttpError.ts'
import { OFFLINE_HEADER } from '../shared/OFFLINE_HEADER.ts'
import { rpcTimeoutSlot } from '../shared/rpcTimeoutSlot.ts'
import { trace } from '../shared/trace.ts'
import type { HttpMethod } from '../shared/types/HttpMethod.ts'
import type { Outbox } from '../shared/types/Outbox.ts'
import type { PersistenceStore } from '../shared/types/PersistenceStore.ts'
import type { RemoteFunction } from '../shared/types/RemoteFunction.ts'
import { UNREACHABLE_STATUSES } from '../shared/UNREACHABLE_STATUSES.ts'
import { withBase } from '../shared/withBase.ts'
import { createOutboxQueue, type OutboxQueue } from './rpcOutbox/createOutboxQueue.ts'
import { outboxRegistry } from './rpcOutbox/outboxRegistry.ts'

/* The framework-reserved `HttpError.kind` for a request the durable outbox parked because
   the server was unreachable — distinct from a handler-declared error name. Lets a caller
   branch with `error instanceof HttpError && error.kind === 'queued'`; `error.data` is the
   parked OutboxEntry, so `await (error.data as OutboxEntry).settled` resolves to the
   eventual delivered result or server refusal. */
const QUEUED = 'queued'

/* A durable RPC's options. `outbox: true` parks an unreachable call for replay; `store`
   exists for testing — production uses the default localStorage persistence. */
export type DurableOptions = {
    outbox?: boolean
    store?: PersistenceStore
}

/*
Client-side substitute for a rpc-defined handler. The bundler emits one
call per rpc export inside an `$rpc/**` module (GET / POST / …): server
target uses defineRpc (real handler), browser target uses remoteProxy
(fetch over the network). Both paths produce identical RemoteFunction
shapes and identical WeakMap metadata so cache() works the same on either
side.

`url` is the flat rpc route. Args go in the JSON body (POST/PUT/PATCH) or
the query string (GET/DELETE/HEAD). Plain `fn(args)` decodes the Response
by Content-Type and throws HttpError on non-2xx; `.raw(args)` is the
escape hatch that returns the Response untouched.
*/
// @readme plumbing
export function remoteProxy<Args, Return>(
    method: HttpMethod,
    url: string,
    durable?: DurableOptions,
): RemoteFunction<Args, Return> {
    /* Assigned after createRemoteFunction so the invoke closure (which runs later, per call)
       parks through the shared queue; undefined leaves the plain fetch path. */
    let queue: OutboxQueue<Args> | undefined
    const fn = createRemoteFunction<Args, Return>({
        method,
        url,
        clients: browserClientFlags,
        /*
        The Request URL carries the mount base so the fetch routes through the
        proxy (/v2/rpc/…); the cache key keeps the bare `url` (keyForRemoteCall
        reads fn.url), so SSR snapshots round-trip base-independently.
        */
        buildRequest: (args) =>
            buildRpcRequest({
                method,
                url: withBase(url),
                args,
                baseUrl: window.location.href,
                headers: rpcHeaders(),
            }),
        /*
        Forcing `getRequest()` once builds the Request and seeds the cache meta thunk in
        createRemoteFunction with the same instance, so cache() readers don't reconstruct it.
        On a durable rpc an unreachable result parks a pristine CLONE and throws a
        `queued`-tagged HttpError — `fetch` consumes the original (its body stream is read and
        locked), so the clone is what a resend can reconstruct. The throw lets the caller
        branch on `error.kind === 'queued'` (parked, will retry) vs. a real server rejection.
        */
        invoke: (args, getRequest) => {
            if (queue === undefined) {
                return fetchWithTimeout(getRequest())
            }
            /* A non-empty queue means an undelivered backlog: park this call at the TAIL and
               throw, rather than let a live fetch leapfrog older writes and land out of
               order. `retry()` then flushes the whole queue FIFO. */
            if (queue.size() > 0) {
                return Promise.reject(
                    queuedThrow(
                        queue,
                        args as Args,
                        getRequest().clone(),
                        unreachableResponse(),
                        undefined,
                    ),
                )
            }
            const request = getRequest()
            const parkable = request.clone()
            return fetchWithTimeout(request).then(
                (response) => {
                    if (UNREACHABLE_STATUSES.has(response.status)) {
                        throw queuedThrow(
                            queue,
                            args as Args,
                            parkable,
                            response,
                            new HttpError(response.clone()),
                        )
                    }
                    return response
                },
                (error: unknown) => {
                    if (shouldParkRejection(error)) {
                        const response =
                            error instanceof HttpError ? error.response : unreachableResponse()
                        throw queuedThrow(queue, args as Args, parkable, response, error)
                    }
                    throw error
                },
            )
        },
    })
    if (durable?.outbox === true) {
        queue = getOrCreateOutboxQueue<Args, Return>(url, fn, durable)
        Object.assign(fn, { outbox: outboxFace(queue) })
    }
    return fn
}

/* The synthetic "unreachable" Response a park reuses when there is no real one — a transport
   failure (fetch rejected) or a backlog park that never fetched. */
function unreachableResponse(): Response {
    return new Response('queued', { status: 503, statusText: 'Service Unavailable' })
}

/* Park the unreachable request (`cause` becomes the entry's parked reason, `entry.error`)
   and return the `kind: 'queued'` HttpError to throw — its `.data` is the parked entry. */
function queuedThrow<Args>(
    queue: OutboxQueue<Args> | undefined,
    args: Args,
    request: Request,
    response: Response,
    cause: unknown,
): HttpError {
    const entry = queue?.park(args, request, cause)
    return new HttpError(response, QUEUED, entry)
}

/* A fetch REJECTION (no Response) the durable rpc should park: a transport failure or the
   synthesized client-timeout 504. NOT a caller abort — that's a deliberate cancel, not the
   server being unreachable. (HTTP error STATUSES never reject — `fetch` resolves with them —
   so 4xx/500 are classified on the response, not here.) */
function shouldParkRejection(error: unknown): boolean {
    if (error instanceof DOMException && error.name === 'AbortError') {
        return false
    }
    if (error instanceof HttpError) {
        return UNREACHABLE_STATUSES.has(error.response.status)
    }
    return true
}

/* The single app-owned queue for a durable RPC url — created + registered on first use so
   every call site (and the global `outbox()`) shares one queue. The send is a plain `fetch`;
   createOutboxQueue rides the entry's abort signal on the resent Request. */
function getOrCreateOutboxQueue<Args, Return>(
    url: string,
    rpc: RemoteFunction<Args, Return>,
    durable: DurableOptions,
): OutboxQueue<Args> {
    const existing = outboxRegistry.get(url)
    if (existing !== undefined) {
        return existing as OutboxQueue<Args>
    }
    const queue = createOutboxQueue<Args>({
        url,
        send: (request) => fetch(request),
        store: durable.store,
    })
    outboxRegistry.register(url, queue as OutboxQueue<unknown>, rpc)
    return queue
}

/* The `.outbox` face: callable for the live entries, `retry()` to drain on demand. */
function outboxFace<Args>(queue: OutboxQueue<Args>): Outbox<Args> {
    const face = (() => queue.entries()) as Outbox<Args>
    face.retry = () => queue.retry()
    return face
}

/*
Applies the env-configured client timeout (BELTE_CLIENT_TIMEOUT, ms) when one
is set; an unset slot fetches unbounded, exactly as before. A timeout abort
surfaces as a 504 HttpError so the error boundary reports an honest status
(errorParamsForThrow reads HttpError.status) instead of a raw DOMException →
500. Other rejections (genuine network failure) propagate untouched.
*/
function fetchWithTimeout(request: Request): Promise<Response> {
    const timeout = rpcTimeoutSlot.ms
    if (timeout === undefined) {
        return fetch(request)
    }
    return fetch(request, { signal: AbortSignal.timeout(timeout) }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
            throw new HttpError(
                new Response('client timeout', { status: 504, statusText: 'Gateway Timeout' }),
            )
        }
        throw error
    })
}

/*
belte's per-RPC headers: the page traceparent (continues the server trace) and,
only while offline, the offline marker so the handler's online() reflects the
caller's connectivity. Returns undefined when neither applies so the
allocation-free fetch path stays the common case.
*/
function rpcHeaders(): Headers | undefined {
    const headers = new Headers()
    let any = false
    const traceparent = trace()
    if (traceparent) {
        headers.set('traceparent', traceparent)
        any = true
    }
    /* Presence = offline; absence = online/unknown. navigator.onLine's offline signal is the reliable direction. */
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        headers.set(OFFLINE_HEADER, '1')
        any = true
    }
    return any ? headers : undefined
}
