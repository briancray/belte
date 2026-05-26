import type { Stream, StreamOptions } from '../types/Stream.ts'
import { getActiveServer } from './serverSlot.ts'
import { registerStream } from './streamRegistry.ts'

/*
Server-side construction of a Stream. The bundler rewrites every
`export const NAME = stream(opts)` inside `src/stream/<file>.ts` into
`__belteDefineStream__("<name>", opts)` so the file path becomes the
stream's identity. Each subscriber gets its own queue + notifier, the
optional history buffer is shared, and outbound fan-out rides Bun's
native `server.publish` so connected ws clients are notified by the
runtime in C rather than per-client iteration in JS.

The Stream itself is the AsyncIterable: `for await (const m of chat)`
replays history then tails live. `chat.tail()` opts out of replay for
callers that only want new values. `chat.publish(m)` is isomorphic —
called server-side it both notifies in-process iterators and broadcasts
to remote subscribers; called client-side (via streamProxy) it sends a
`pub` frame the dispatcher validates and forwards.
*/
export function defineStream<T>(name: string, opts: StreamOptions = {}): Stream<T> {
    const historySize = opts.history ?? 0
    const buffer: T[] = []
    const subscribers = new Set<(message: T) => void>()

    function publish(message: T): void {
        if (historySize > 0) {
            buffer.push(message)
            if (buffer.length > historySize) {
                buffer.shift()
            }
        }
        for (const notify of subscribers) {
            notify(message)
        }
        const server = getActiveServer()
        if (server) {
            server.publish(`stream:${name}`, JSON.stringify({ type: 'msg', stream: name, message }))
        }
    }

    function iterate(withHistory: boolean): AsyncIterable<T> {
        return {
            [Symbol.asyncIterator](): AsyncIterator<T, void, undefined> {
                /*
                Per-iterator queue: a single notifier wakes the pending
                pull when a publish arrives. Removing the subscriber
                inside `return()` drops the notifier reference so a
                shut-down iterator can be GC'd even if a notify is in
                flight (the guard skips the queue push for a deleted
                subscriber).
                */
                const queue: T[] = withHistory ? [...buffer] : []
                let notify: (() => void) | undefined
                let active = true
                const subscriber = (message: T) => {
                    if (!active) {
                        return
                    }
                    queue.push(message)
                    notify?.()
                    notify = undefined
                }
                subscribers.add(subscriber)
                return {
                    async next() {
                        if (!active) {
                            return { value: undefined, done: true }
                        }
                        while (queue.length === 0) {
                            if (!active) {
                                return { value: undefined, done: true }
                            }
                            await new Promise<void>((resolve) => {
                                notify = resolve
                            })
                        }
                        return { value: queue.shift() as T, done: false }
                    },
                    async return() {
                        active = false
                        subscribers.delete(subscriber)
                        notify?.()
                        notify = undefined
                        return { value: undefined, done: true }
                    },
                }
            },
        }
    }

    const self: Stream<T> = {
        name,
        publish,
        tail: () => iterate(false),
        [Symbol.asyncIterator]: () => iterate(true)[Symbol.asyncIterator](),
    }
    registerStream({
        stream: self as Stream<unknown>,
        allowClientPublish: opts.clientPublish ?? false,
        snapshotHistory: () => [...buffer],
    })
    return self
}
