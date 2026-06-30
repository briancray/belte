import { createLifecycleChannel } from '../../shared/createLifecycleChannel.ts'
import { decodeResponse } from '../../shared/decodeResponse.ts'
import type { OutboxEntry, OutboxStatus } from '../../shared/types/OutboxEntry.ts'
import type { PersistenceStore } from '../../shared/types/PersistenceStore.ts'
import { UNREACHABLE_STATUSES } from '../../shared/UNREACHABLE_STATUSES.ts'
import { localStoragePersistence } from './localStoragePersistence.ts'

/* Persisted form of an entry — the Request reduced to its replayable parts (a live
   Request + AbortController don't serialize). `body`/`contentType` are captured
   asynchronously just after park (Request.text() is async); they seed empty and fill
   in before any reload, so a restored entry replays with its original body. */
type StoredEntry<Args> = {
    id: string
    args: Args
    method: string
    url: string
    body: string
    contentType: string
    status: OutboxStatus
}

/* Non-serializable identity for a live entry: its abort handle, the in-session Request
   (body intact), and the per-entry retry trigger. Rebuilt from the persisted item on a
   cold read after reload. */
type Identity = { controller: AbortController; request: Request; retry: () => Promise<void> }

export type OutboxQueue<Args> = {
    park: (args: Args, request: Request, reason?: unknown) => OutboxEntry<Args>
    entries: () => OutboxEntry<Args>[]
    /* Undelivered-entry count — the same reactive read as `entries()`, without building
       the entry objects. A caller parks straight to the tail when this is non-empty. */
    size: () => number
    retry: () => Promise<void>
    drain: () => Promise<void>
    dispose: () => void
}

/* Persistence key per RPC url — the queue's durable identity. */
const keyFor = (url: string): string => `belte:outbox:${url}`

/*
A durable, app-owned FIFO retry queue for one RPC. A call fetches directly and throws as
before while the queue is empty; when the server can't be reached — a transport failure or
a 502/503/504/520–527/530 — the caller `park`s the request here (a side-effect; the call still
throws), and once a backlog exists the caller parks every later call at the tail too, so
FIFO order is preserved on replay. The queue is a plain array persisted through an injected
`PersistenceStore` (localStorage by default), so it survives a reload; a `createLifecycleChannel`
makes `entries()`/`size()` reactive (they re-derive inside $derived/$effect as the queue
changes). Draining is manual — the app calls `retry()` when it decides to replay; nothing
drains automatically. The drain re-sends head-first: any server response removes the entry —
a 2xx (delivered) AND a real 4xx/500 (the server handled+rejected it; retrying won't help, so
it leaves the queue) — while a still-unreachable result keeps it `queued` for the next
`retry()`, and an abort removes it. Resends run under the entry's OWN abort signal alone —
scope-abort and the client timeout are deliberately not composed in, so a parked write
survives an unmount and waits out the outage.
*/
export function createOutboxQueue<Args>(opts: {
    url: string
    send: (request: Request) => Promise<Response>
    store?: PersistenceStore
}): OutboxQueue<Args> {
    const store = opts.store ?? localStoragePersistence()
    const key = keyFor(opts.url)
    const loaded = store?.load(key)
    /* The queue document. Live (controller + Request) state lives in `live`; this array is
       the persisted, serializable backbone. */
    let items: StoredEntry<Args>[] = Array.isArray(loaded) ? (loaded as StoredEntry<Args>[]) : []
    /* "Membership or state changed" signal for the reactive reads — the outbox counterpart
       of the cache store's and tail registry's lifecycle channels. */
    const lifecycle = createLifecycleChannel()
    /* Live identity (controller + Request + retry) by id, rebuilt from persisted items on a
       cold read; `errors` is transient last-failure state (never persisted). */
    const live = new Map<string, Identity>()
    const errors = new Map<string, unknown>()

    type Settler = {
        promise: Promise<unknown>
        resolve: (value: unknown) => void
        reject: (error: unknown) => void
    }
    /* Per-entry `settled` deferreds, created lazily on first read of `entry.settled` (so a
       never-awaited refusal can't become an unhandled rejection) and resolved/rejected once
       at the drain exit. Transient — a reload starts fresh. */
    const settlers = new Map<string, Settler>()

    const settledFor = (id: string): Promise<unknown> => {
        const existing = settlers.get(id)
        if (existing !== undefined) {
            return existing.promise
        }
        let resolve!: (value: unknown) => void
        let reject!: (error: unknown) => void
        const promise = new Promise<unknown>((res, rej) => {
            resolve = res
            reject = rej
        })
        settlers.set(id, { promise, resolve, reject })
        return promise
    }

    /* Settle an id's deferred (if armed) and drop it — single-shot. */
    const settle = (id: string, run: (settler: Settler) => void): void => {
        const settler = settlers.get(id)
        if (settler !== undefined) {
            run(settler)
            settlers.delete(id)
        }
    }

    /* Persist the array and ping the reactive readers. Every mutation funnels through here. */
    const commit = (): void => {
        store?.save(key, items)
        lifecycle.mark()
    }

    const remove = (id: string): void => {
        const index = items.findIndex((item) => item.id === id)
        if (index !== -1) {
            items.splice(index, 1)
            commit()
        }
        live.delete(id)
        errors.delete(id)
        /* A cancel/supersede removal with nobody having delivered first → reject `settled`
           as a canceled call would. Delivery/refusal settle before calling remove, so this
           is a no-op for them (single-shot). */
        settle(id, (s) => s.reject(new DOMException('The outbox entry was canceled', 'AbortError')))
    }

    const setStatus = (id: string, status: OutboxStatus): void => {
        const current = items.find((item) => item.id === id)
        if (current !== undefined) {
            current.status = status
            commit()
        }
    }

    /* The non-serializable identity for an id: reuse the live one (Request body intact in
       session), else rebuild from the persisted parts (fresh controller, cold reload). */
    const identityFor = (item: StoredEntry<Args>): Identity => {
        const existing = live.get(item.id)
        if (existing !== undefined) {
            return existing
        }
        const controller = new AbortController()
        controller.signal.addEventListener('abort', () => remove(item.id), { once: true })
        /* `body || undefined` so a bodyless method rebuilds without one (GET/DELETE with a
           body throws). */
        const request = new Request(item.url, {
            method: item.method,
            body: item.body || undefined,
            headers: item.contentType ? { 'content-type': item.contentType } : undefined,
        })
        const identity: Identity = { controller, request, retry: () => drain() }
        live.set(item.id, identity)
        return identity
    }

    const toLive = (item: StoredEntry<Args>): OutboxEntry<Args> => {
        const { controller, request, retry } = identityFor(item)
        return {
            id: item.id,
            controller,
            request,
            args: item.args,
            status: item.status,
            error: errors.get(item.id),
            retry,
            /* Lazy: the deferred is only armed when someone reads `settled`. */
            get settled() {
                return settledFor(item.id)
            },
        }
    }

    /* Persist the request body + content type just after park (Request.text() is async).
       The in-session drain replays the LIVE request (body intact) regardless; this fills
       the persisted form before any reload. A bodyless method leaves the empty seed. */
    const captureRequest = async (id: string, request: Request): Promise<void> => {
        const body = request.body === null ? '' : await request.clone().text()
        const contentType = request.headers.get('content-type') ?? ''
        const current = items.find((item) => item.id === id)
        if (current === undefined) {
            return
        }
        current.body = body
        current.contentType = contentType
        commit()
    }

    /* Resends run under the entry's OWN signal only — a parked write survives unmount +
       waits out the outage, so scope-abort + client-timeout are NOT composed in. */
    const sendable = (entry: OutboxEntry<Args>): Request =>
        new Request(entry.request, { signal: entry.controller.signal })

    let draining = false
    let settled: Promise<void> = Promise.resolve()
    const drain = (): Promise<void> => {
        if (draining) {
            return settled
        }
        draining = true
        settled = (async () => {
            try {
                while (true) {
                    const head = items[0]
                    if (head === undefined) {
                        break
                    }
                    const entry = toLive(head)
                    if (entry.controller.signal.aborted) {
                        remove(head.id) // canceled while queued
                        continue
                    }
                    setStatus(head.id, 'sending')
                    try {
                        const response = await opts.send(sendable(entry))
                        if (UNREACHABLE_STATUSES.has(response.status)) {
                            setStatus(head.id, 'queued') // still down → wait for the next trigger
                            break
                        }
                        /* The server responded — 2xx OR a real 4xx/500. Either way it
                           HANDLED the request, so the entry leaves the queue and the next
                           proceeds in order. Decode it exactly as a live call would so
                           `settled` resolves with the result, or rejects with the real
                           HttpError on a refusal. */
                        try {
                            const value = await decodeResponse(response)
                            settle(head.id, (s) => s.resolve(value))
                        } catch (responseError) {
                            settle(head.id, (s) => s.reject(responseError))
                        }
                        remove(head.id)
                        continue
                    } catch {
                        if (entry.controller.signal.aborted) {
                            remove(head.id) // canceled mid-send
                            continue
                        }
                        /* Transport failure on resend — still unreachable, keep queued. */
                        setStatus(head.id, 'queued')
                        break
                    }
                }
            } finally {
                draining = false
            }
        })()
        return settled
    }

    return {
        park(args, request, reason) {
            const id = crypto.randomUUID()
            const controller = new AbortController()
            controller.signal.addEventListener('abort', () => remove(id), { once: true })
            live.set(id, { controller, request, retry: () => drain() })
            if (reason !== undefined) {
                errors.set(id, reason)
            }
            items.push({
                id,
                args,
                method: request.method,
                url: request.url,
                body: '',
                contentType: '',
                status: 'queued',
            })
            commit()
            void captureRequest(id, request)
            const item = items.find((entry) => entry.id === id) as StoredEntry<Args>
            return toLive(item)
        },
        entries() {
            lifecycle.track()
            return items.map(toLive)
        },
        size() {
            lifecycle.track()
            return items.length
        },
        retry() {
            return drain()
        },
        drain,
        dispose() {
            /* No live subscription to tear down — the persisted snapshot survives so a
               reload rehydrates it. Clearing unsynced work is the app's call (clear
               persistence). */
        },
    }
}
