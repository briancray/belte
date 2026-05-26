import type { StreamClientFrame } from '../types/StreamClientFrame.ts'
import type { StreamServerFrame } from '../types/StreamServerFrame.ts'

type SubCallbacks = {
    onMessage(message: unknown): void
    onError(message: string): void
    onEnd(): void
}

type Channel = {
    subscribe(sub: string, stream: string, tail: boolean, callbacks: SubCallbacks): void
    unsubscribe(sub: string): void
    publish(stream: string, message: unknown): void
}

const STREAM_PATH = '/__belte/stream'

let singleton: Channel | undefined

/*
Lazily opens the single multiplexed ws used by every stream proxy on
the page. Routes inbound frames:
  `msg` → all local subs of that stream
  `end` → the matching sub
  `err` → the matching sub

`msg` frames carry no sub id: one publish from the server fans out to
every connected ws via Bun's native publish, and each ws delivers the
message to every local sub of that stream. `end`/`err` are per-sub
because they're subscription-lifecycle events, not data.

Outbound frames sent before `ws.onopen` fires are queued and flushed
on open. The channel reconnects on close with bounded backoff;
in-flight subs are torn down with a synthetic error so consumers'
`for await` loops can surface the disconnect, then the connection
comes back up and fresh subs can be opened. We intentionally do not
silently re-subscribe across a reconnect — most stream consumers need
to reconcile state on a fresh connection (e.g. re-fetch a snapshot
before reapplying deltas), so the framework hands the disconnect to
user code instead of papering over it.
*/
export function getStreamChannel(): Channel {
    if (singleton) {
        return singleton
    }
    const subs = new Map<string, { stream: string; callbacks: SubCallbacks }>()
    const subsByStream = new Map<string, Set<string>>()
    let ws: WebSocket | undefined
    let pendingSends: string[] = []
    let backoffMs = 250

    function flushPending(): void {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return
        }
        for (const message of pendingSends) {
            ws.send(message)
        }
        pendingSends = []
    }

    function send(frame: StreamClientFrame): void {
        const message = JSON.stringify(frame)
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(message)
            return
        }
        pendingSends.push(message)
        connect()
    }

    function connect(): void {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return
        }
        const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        ws = new WebSocket(`${scheme}//${window.location.host}${STREAM_PATH}`)
        ws.addEventListener('open', () => {
            backoffMs = 250
            flushPending()
        })
        ws.addEventListener('message', (event) => {
            let frame: StreamServerFrame
            try {
                frame = JSON.parse(event.data) as StreamServerFrame
            } catch {
                return
            }
            if (frame.type === 'msg') {
                /*
                One Bun-published frame fans out to every local sub of
                that stream on this ws — addressed by stream name, not
                per-sub id.
                */
                const targets = subsByStream.get(frame.stream)
                if (!targets) {
                    return
                }
                for (const subId of targets) {
                    subs.get(subId)?.callbacks.onMessage(frame.message)
                }
                return
            }
            if (frame.type === 'end') {
                const sub = subs.get(frame.sub)
                if (!sub) {
                    return
                }
                dropSub(frame.sub)
                sub.callbacks.onEnd()
                return
            }
            if (frame.type === 'err') {
                const sub = subs.get(frame.sub)
                if (!sub) {
                    return
                }
                dropSub(frame.sub)
                sub.callbacks.onError(frame.message)
                return
            }
        })
        ws.addEventListener('close', () => {
            const active = [...subs.entries()]
            subs.clear()
            subsByStream.clear()
            for (const [, sub] of active) {
                sub.callbacks.onError('stream socket disconnected')
            }
            ws = undefined
            if (active.length === 0 && pendingSends.length === 0) {
                return
            }
            setTimeout(connect, backoffMs)
            backoffMs = Math.min(backoffMs * 2, 5000)
        })
    }

    function dropSub(id: string): void {
        const entry = subs.get(id)
        if (!entry) {
            return
        }
        subs.delete(id)
        const set = subsByStream.get(entry.stream)
        if (set) {
            set.delete(id)
            if (set.size === 0) {
                subsByStream.delete(entry.stream)
            }
        }
    }

    singleton = {
        subscribe(id, stream, tail, callbacks) {
            subs.set(id, { stream, callbacks })
            let set = subsByStream.get(stream)
            if (!set) {
                set = new Set()
                subsByStream.set(stream, set)
            }
            set.add(id)
            send({ type: 'sub', sub: id, stream, tail: tail ? true : undefined })
        },
        unsubscribe(id) {
            if (!subs.has(id)) {
                return
            }
            dropSub(id)
            send({ type: 'unsub', sub: id })
        },
        publish(stream, message) {
            send({ type: 'pub', stream, message })
        },
    }
    return singleton
}
