import type { Stream } from '../types/Stream.ts'
import { getStreamChannel } from './streamChannel.ts'

let nextId = 0

/*
Client-side substitute for a server-declared Stream. The bundler emits
one call per stream export under `src/stream/`: server target uses
defineStream (real fan-out), browser target uses streamProxy (subscribe
over the multiplexed ws channel). Both paths produce identical Stream
shapes so user code reads the same on either side.

Iterating the stream opens a fresh subscription with history replay;
`.tail()` opens one without. Each subscription mints its own id used to
route lifecycle frames (`end`, `err`). Calling `.publish` sends a `pub`
frame the server validates against the topic's `allowClientPublish`
policy — there is no client-side enforcement, so a publish attempt on a
server-only topic is silently dropped server-side.
*/
export function streamProxy<T>(name: string): Stream<T> {
    function iterate(tail: boolean): AsyncIterable<T> {
        return {
            [Symbol.asyncIterator](): AsyncIterator<T, void, undefined> {
                const id = `s${++nextId}`
                const channel = getStreamChannel()
                type Slot =
                    | { kind: 'value'; value: T }
                    | { kind: 'end' }
                    | { kind: 'error'; message: string }
                /*
                Single-slot mailbox + matched waiter: each yielded
                message either lands in the buffer (if no one's
                awaiting) or wakes the pending pull. Backpressure is
                unbounded — a slow consumer with a chatty stream will
                grow the buffer; bounded policies belong in a future
                streamProxy API, not the wire layer.
                */
                const buffer: Slot[] = []
                let waiter: ((slot: Slot) => void) | undefined
                let closed = false

                function push(slot: Slot): void {
                    if (waiter) {
                        const w = waiter
                        waiter = undefined
                        w(slot)
                        return
                    }
                    buffer.push(slot)
                }

                channel.subscribe(id, name, tail, {
                    onMessage: (value) => push({ kind: 'value', value: value as T }),
                    onEnd: () => push({ kind: 'end' }),
                    onError: (message) => push({ kind: 'error', message }),
                })

                return {
                    async next() {
                        if (closed) {
                            return { value: undefined, done: true }
                        }
                        const slot =
                            buffer.shift() ?? (await new Promise<Slot>((r) => (waiter = r)))
                        if (slot.kind === 'end') {
                            closed = true
                            return { value: undefined, done: true }
                        }
                        if (slot.kind === 'error') {
                            closed = true
                            throw new Error(slot.message)
                        }
                        return { value: slot.value, done: false }
                    },
                    async return() {
                        if (closed) {
                            return { value: undefined, done: true }
                        }
                        closed = true
                        channel.unsubscribe(id)
                        return { value: undefined, done: true }
                    },
                }
            },
        }
    }

    return {
        name,
        publish(message: T) {
            getStreamChannel().publish(name, message)
        },
        tail: () => iterate(true),
        [Symbol.asyncIterator]: () => iterate(false)[Symbol.asyncIterator](),
    }
}
