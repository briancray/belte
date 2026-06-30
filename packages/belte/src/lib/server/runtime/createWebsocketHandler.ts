import type { ServerWebSocket } from 'bun'
import type { createSocketDispatcher } from '../sockets/createSocketDispatcher.ts'

/*
Bun's websocket handler block for the sockets hub: every Socket declared under
src/server/sockets/ multiplexes onto one framework-owned connection per client
at /__belte/sockets. The handlers delegate straight to the dispatcher, which
owns the open/message/close lifecycle so user code never sees the raw ws.
Extracted as a plain move from createServer; the returned object is exactly the
shape Bun.serve's `websocket` field expects.
*/
export function createWebsocketHandler(
    socketDispatcher: ReturnType<typeof createSocketDispatcher>,
): {
    open(ws: ServerWebSocket<unknown>): void
    message(ws: ServerWebSocket<unknown>, data: string | Buffer): void
    close(ws: ServerWebSocket<unknown>): void
} {
    return {
        open(ws) {
            socketDispatcher.open(ws)
        },
        message(ws, data) {
            socketDispatcher.message(ws, data)
        },
        close(ws) {
            socketDispatcher.close(ws)
        },
    }
}
