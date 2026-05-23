import type { Server } from 'bun'
import type { SocketData } from '../types/App.ts'

/*
Internal holder for the active Bun.serve instance. setActiveServer is called
once from createServer after Bun.serve resolves; the public `server` import
reads through this slot and throws when accessed before init completes.
*/
let active: Server<SocketData> | undefined

export function setActiveServer(server: Server<SocketData>): void {
    active = server
}

export function getActiveServer(): Server<SocketData> | undefined {
    return active
}
