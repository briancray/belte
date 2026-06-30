import type { InspectorRpc } from './InspectorRpc.ts'
import type { InspectorSocket } from './InspectorSocket.ts'

/*
The app's machine surface projected for the inspector — the static catalog the
UI renders. Built by reading the rpc and socket registries after they're
eager-loaded, so a freshly-booted server lists its whole surface, not just the
rpcs hit so far. Pages stay out: they're the human surface, already navigable.
*/
export type InspectorSurface = {
    rpcs: InspectorRpc[]
    sockets: InspectorSocket[]
}
