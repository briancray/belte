import type { StandardSchemaV1 } from './StandardSchemaV1.ts'

/*
A rpc's declared error set, keyed by error NAME (not status, so two errors can
share a status). Each entry names its HTTP `status` and an optional `data`
schema whose inferred input the error constructor requires. Passed as the rpc's
`errors` opt; the handler receives matching constructors (see ErrorConstructors)
and the client's `rpc.isError` guard narrows a caught error's `.data` per name
(see RpcErrorGuard).
*/
export type ErrorSpec = Record<string, { status: number; data?: StandardSchemaV1 }>
