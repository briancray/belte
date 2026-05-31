import type { SocketRegistryEntry } from './types/SocketRegistryEntry.ts'

/*
Recent slice of a socket's history buffer: the last `count` messages, or
the whole buffer when `count` is undefined. Shared by the sockets HTTP
`rest()` face and the MCP `<base>-tail` tool so the two can't drift.
*/
export function recentHistory(entry: SocketRegistryEntry, count: number | undefined): unknown[] {
    const history = entry.snapshotHistory()
    return count === undefined ? history : history.slice(Math.max(0, history.length - count))
}
