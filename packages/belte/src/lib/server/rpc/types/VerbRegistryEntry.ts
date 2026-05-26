import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { RemoteFunction } from './RemoteFunction.ts'
import type { StandardSchemaV1 } from './StandardSchemaV1.ts'

/*
Per-verb registry record on the server side. MCP and CLI enumerate this
to discover which RPCs are advertised (clients flags) and what input
shape they expect (schema). The schema and resolved clients stay off the
public RemoteFunction shape so the browser-side proxy doesn't need to
carry server-only state.
*/
export type VerbRegistryEntry = {
    remote: RemoteFunction<unknown, unknown>
    schema: StandardSchemaV1 | undefined
    jsonSchema: Record<string, unknown> | undefined
    clients: ClientFlags
}
