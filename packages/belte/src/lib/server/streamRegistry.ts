import type { Stream } from '../types/Stream.ts'

/*
Process-wide registry of every Stream declared in the app. defineStream
inserts on first construction; the dispatcher reads on every `sub` /
`pub` frame so it can find the right Stream by name and check the
opted-in `allowClientPublish` policy. The Stream type stays uniform
between server and client (no policy fields leaked into the public
shape) by parking that policy here instead.
*/
type Entry = {
    stream: Stream<unknown>
    allowClientPublish: boolean
    snapshotHistory(): unknown[]
}

const registry = new Map<string, Entry>()

export function registerStream(entry: Entry): void {
    registry.set(entry.stream.name, entry)
}

export function lookupStream(name: string): Entry | undefined {
    return registry.get(name)
}
