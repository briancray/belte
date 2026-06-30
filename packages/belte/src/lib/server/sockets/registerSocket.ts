import { registryRevision } from '../registryRevision.ts'
import { socketRegistry } from './socketRegistry.ts'
import type { SocketRegistryEntry } from './types/SocketRegistryEntry.ts'

export function registerSocket(entry: SocketRegistryEntry): void {
    socketRegistry.set(entry.socket.name, entry)
    registryRevision.bump()
}
