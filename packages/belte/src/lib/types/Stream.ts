/*
Bidirectional named broadcast primitive. Declared once with `stream<T>()`
inside a file under `src/stream/`; the same import resolves to a server-side
fan-out and a client-side ws proxy by build target. Iterating the stream
opens a subscription (with history replay if the topic was declared with
`{ history: n }`); `.tail()` opens one without the replay. `publish` is
isomorphic: server code publishes in-process and fans out to remote
subscribers; client code sends a `pub` frame the dispatcher validates
against the topic's `clientPublish` flag.
*/
export interface Stream<T> extends AsyncIterable<T> {
    readonly name: string
    publish(message: T): void
    tail(): AsyncIterable<T>
}

export type StreamOptions = {
    history?: number
    clientPublish?: boolean
}
