import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'

/*
Bidirectional named broadcast primitive. Declared once with `socket<T>()`
inside a file under `src/server/sockets/`; the same import resolves to a server-side
fan-out and a client-side ws proxy by build target. Iterating the socket
opens a subscription with full history replay if the topic was declared
with `{ history: n }`. `.tail(count)` opens one that replays the last
`count` items (default `0`, clamped to the topic's history max) before
tailing live. `publish` is isomorphic: server code publishes in-process
and fans out to remote subscribers; client code sends a `pub` frame the
dispatcher validates against the topic's `clientPublish` flag. `clients`
exposes which adapter surfaces (browser / mcp / cli) advertise this
socket.
*/
export interface Socket<T> extends AsyncIterable<T> {
    readonly name: string
    readonly clients: ClientFlags
    publish(message: T): void
    tail(count?: number): AsyncIterable<T>
}
