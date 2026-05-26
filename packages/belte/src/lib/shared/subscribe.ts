import { createSubscriber } from 'svelte/reactivity'
import type { Stream } from '../types/Stream.ts'

type SubscriptionStatus = 'pending' | 'open' | 'done' | 'error'

type Entry<T> = {
    latest: T | undefined
    error: Error | undefined
    status: SubscriptionStatus
    tap: () => void
}

const registry = new Map<string, Entry<unknown>>()

/*
Reactive consumer for streams. Pass the Stream itself:

  const latest = $derived(subscribe(chat))

Lifecycle mirrors cache(): the entry's tracker is a Svelte
createSubscriber, so the first $derived read in a tracking scope opens
the stream (with history replay so newcomers see the latest known
value immediately), and the last $derived to stop reading closes it.
Many $deriveds reading the same stream share one underlying
subscription.

Subscribe is a no-op on the server (returns undefined) — SSR can't
keep a stream open across the request boundary. Pages that want a
seeded value in the initial HTML should fetch via cache() against an
HTTP route and layer subscribe() on top for live updates after
hydration.

Errors are surfaced through subscribe.error(stream) rather than
thrown, so reading `latest` from a $derived can't crash the component.
Status distinguishes "haven't received the first frame" (pending) from
"stream ended cleanly" (done) and "wire layer surfaced an error"
(error).
*/
export function subscribe<T>(stream: Stream<T>): T | undefined {
    return readField(stream, 'latest') as T | undefined
}

subscribe.error = function subscribeError<T>(stream: Stream<T>): Error | undefined {
    return readField(stream, 'error') as Error | undefined
}

subscribe.status = function subscribeStatus<T>(stream: Stream<T>): SubscriptionStatus {
    return (readField(stream, 'status') as SubscriptionStatus | undefined) ?? 'pending'
}

function readField<T, K extends keyof Entry<T>>(
    stream: Stream<T>,
    field: K,
): Entry<T>[K] | undefined {
    if (typeof window === 'undefined') {
        if (field === 'status') {
            return 'pending' as Entry<T>[K]
        }
        return undefined
    }
    const entry = getOrCreateEntry(stream) as Entry<T>
    entry.tap()
    return entry[field]
}

function getOrCreateEntry<T>(stream: Stream<T>): Entry<T> {
    const key = stream.name
    const cached = registry.get(key) as Entry<T> | undefined
    if (cached) {
        return cached
    }
    const entry: Entry<T> = {
        latest: undefined,
        error: undefined,
        status: 'pending',
        tap: () => undefined,
    }
    entry.tap = createSubscriber((update) => {
        entry.latest = undefined
        entry.error = undefined
        entry.status = 'pending'
        const iterator = stream[Symbol.asyncIterator]()
        let cancelled = false
        ;(async () => {
            try {
                while (!cancelled) {
                    const next = await iterator.next()
                    if (next.done) {
                        if (!cancelled) {
                            if (entry.status !== 'error') {
                                entry.status = 'done'
                            }
                            update()
                        }
                        return
                    }
                    entry.latest = next.value
                    entry.status = 'open'
                    update()
                }
            } catch (error) {
                if (!cancelled) {
                    entry.error = error instanceof Error ? error : new Error(String(error))
                    entry.status = 'error'
                    update()
                }
            }
        })()
        return () => {
            cancelled = true
            iterator.return?.(undefined)?.catch(() => undefined)
            registry.delete(key)
        }
    })
    registry.set(key, entry as Entry<unknown>)
    return entry
}
