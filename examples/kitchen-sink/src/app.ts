import type { SocketData } from 'belte/types/App'
import type { AppModule } from 'belte/types/AppModule'
import type { ServerWebSocket } from 'bun'

declare module 'belte/types/App' {
    interface SocketData {
        id: number
    }
}

let nextId = 0

export const socket: AppModule['socket'] = {
    upgrade: () => ({ data: { id: ++nextId } }),
    open(ws: ServerWebSocket<SocketData>) {
        ws.send(`hi #${ws.data.id}`)
    },
    message(ws: ServerWebSocket<SocketData>, msg) {
        ws.send(`echo: ${msg}`)
    },
}
