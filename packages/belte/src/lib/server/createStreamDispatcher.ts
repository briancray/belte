import type { ServerWebSocket } from 'bun'
import { log } from '../shared/log.ts'
import type { StreamClientFrame } from '../types/StreamClientFrame.ts'
import type { StreamRoutes } from '../types/StreamRoutes.ts'
import { lookupStream } from './streamRegistry.ts'

type StreamDispatcher = {
    open(ws: ServerWebSocket<unknown>): void
    message(ws: ServerWebSocket<unknown>, data: string | Buffer): void
    close(ws: ServerWebSocket<unknown>): void
}

/*
Per-connection state: which streams this ws is currently subscribed to
(at the Bun-topic level), and which `sub` ids map to which stream. One
ws can hold multiple subs against the same stream (e.g. one with
history, one without); the Bun-topic subscription is reference-counted
so we only `ws.unsubscribe` when the last local sub drops.
*/
type ConnectionState = {
    subToStream: Map<string, string>
    streamSubs: Map<string, Set<string>>
}

/*
Bridges the framework's stream registry to a single ws per client. All
streams multiplex over `/__belte/stream`. Steady-state fan-out rides
Bun's native `server.publish('stream:<name>', frame)` so the dispatcher
is only on the path for sub/unsub bookkeeping and client-initiated pub
validation; the published `msg` frames go from publisher to subscribers
without touching JS per frame.

`sub` opens a subscription: history is replayed (unless the client
passed `tail: true`) directly to this ws, then the ws is added to the
Bun topic. `unsub` drops the local sub and unsubscribes the ws from
the Bun topic if no other local subs remain. `pub` validates the
stream's `allowClientPublish` policy and calls `stream.publish` —
which fans out to in-process iterators and republishes through Bun
to other connected clients.

Module-level lookups are cached per stream name: loading a stream
module triggers its `defineStream` call, which inserts into the
registry. After that the dispatcher just reads the registry.
*/
export function createStreamDispatcher(streams: StreamRoutes): StreamDispatcher {
    const moduleCache = new Map<string, Promise<void>>()
    const connections = new WeakMap<ServerWebSocket<unknown>, ConnectionState>()

    function ensureLoaded(name: string): Promise<void> | undefined {
        const existing = moduleCache.get(name)
        if (existing) {
            return existing
        }
        const loader = streams[name]
        if (!loader) {
            return undefined
        }
        const promise = loader().then(() => undefined)
        moduleCache.set(name, promise)
        return promise
    }

    function send(ws: ServerWebSocket<unknown>, frame: unknown): void {
        if (ws.readyState !== 1) {
            return
        }
        ws.send(JSON.stringify(frame))
    }

    function addSub(state: ConnectionState, name: string, sub: string): boolean {
        state.subToStream.set(sub, name)
        let subs = state.streamSubs.get(name)
        if (!subs) {
            subs = new Set()
            state.streamSubs.set(name, subs)
        }
        const wasEmpty = subs.size === 0
        subs.add(sub)
        return wasEmpty
    }

    function removeSub(state: ConnectionState, sub: string): string | undefined {
        const name = state.subToStream.get(sub)
        if (!name) {
            return undefined
        }
        state.subToStream.delete(sub)
        const subs = state.streamSubs.get(name)
        if (!subs) {
            return undefined
        }
        subs.delete(sub)
        if (subs.size === 0) {
            state.streamSubs.delete(name)
            return name
        }
        return undefined
    }

    async function handleSub(
        ws: ServerWebSocket<unknown>,
        state: ConnectionState,
        frame: Extract<StreamClientFrame, { type: 'sub' }>,
    ): Promise<void> {
        const loader = ensureLoaded(frame.stream)
        if (!loader) {
            send(ws, {
                type: 'err',
                sub: frame.sub,
                message: `[belte] no stream registered at ${frame.stream}`,
            })
            send(ws, { type: 'end', sub: frame.sub })
            return
        }
        try {
            await loader
        } catch (error) {
            log.error(error)
            send(ws, {
                type: 'err',
                sub: frame.sub,
                message: error instanceof Error ? error.message : String(error),
            })
            send(ws, { type: 'end', sub: frame.sub })
            return
        }
        const entry = lookupStream(frame.stream)
        if (!entry) {
            send(ws, {
                type: 'err',
                sub: frame.sub,
                message: `[belte] stream module at ${frame.stream} did not register a Stream export`,
            })
            send(ws, { type: 'end', sub: frame.sub })
            return
        }
        const isFirstLocalSub = addSub(state, frame.stream, frame.sub)
        if (isFirstLocalSub) {
            ws.subscribe(`stream:${frame.stream}`)
        }
        if (!frame.tail) {
            /*
            Replay history directly to this ws via ws.send (not
            server.publish) so other connected subscribers don't see the
            replay. Live messages published from now on flow through the
            Bun topic the ws just joined; clients may observe live
            messages interleaved with the tail of history, so user
            payloads should carry an id/timestamp when ordering matters.
            */
            for (const message of entry.snapshotHistory()) {
                send(ws, { type: 'msg', stream: frame.stream, message })
            }
        }
    }

    function handleUnsub(
        ws: ServerWebSocket<unknown>,
        state: ConnectionState,
        frame: Extract<StreamClientFrame, { type: 'unsub' }>,
    ): void {
        const emptied = removeSub(state, frame.sub)
        if (emptied) {
            ws.unsubscribe(`stream:${emptied}`)
        }
        send(ws, { type: 'end', sub: frame.sub })
    }

    async function handlePub(
        ws: ServerWebSocket<unknown>,
        frame: Extract<StreamClientFrame, { type: 'pub' }>,
    ): Promise<void> {
        const loader = ensureLoaded(frame.stream)
        if (!loader) {
            return
        }
        try {
            await loader
        } catch (error) {
            log.error(error)
            return
        }
        const entry = lookupStream(frame.stream)
        if (!entry) {
            return
        }
        if (!entry.allowClientPublish) {
            /*
            Silent drop: the publish is rejected because the topic
            wasn't declared `{ clientPublish: true }`. Surfacing this as
            an error per-publish would tempt apps to attempt-then-handle
            instead of routing through an HTTP route for auth. Log it
            once per process at debug level (out of scope here) if
            visibility is needed.
            */
            return
        }
        entry.stream.publish(frame.message)
        /*
        ws parameter retained for future per-ws auth context (cookies on
        upgrade) the canPublish hook would consult.
        */
        void ws
    }

    return {
        open(ws) {
            connections.set(ws, { subToStream: new Map(), streamSubs: new Map() })
        },

        message(ws, data) {
            const state = connections.get(ws)
            if (!state) {
                return
            }
            const text = typeof data === 'string' ? data : data.toString('utf8')
            let frame: StreamClientFrame
            try {
                frame = JSON.parse(text) as StreamClientFrame
            } catch {
                return
            }
            if (frame.type === 'sub') {
                void handleSub(ws, state, frame)
                return
            }
            if (frame.type === 'unsub') {
                handleUnsub(ws, state, frame)
                return
            }
            if (frame.type === 'pub') {
                void handlePub(ws, frame)
                return
            }
        },

        close(ws) {
            const state = connections.get(ws)
            if (!state) {
                return
            }
            connections.delete(ws)
            for (const name of state.streamSubs.keys()) {
                ws.unsubscribe(`stream:${name}`)
            }
        },
    }
}
