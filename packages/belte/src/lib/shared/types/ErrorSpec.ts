import type { StandardSchemaV1 } from './StandardSchemaV1.ts'

/*
The shape of a typed error's spec entry, keyed by error NAME (not status, so two
errors can share a status): an HTTP `status` and an optional `data` schema whose
inferred input the error constructor requires. An `error.typed(name, status,
schema?)` constructor carries its entry in the `TypedError` brand; the rpc helper
rebuilds the `Errors` map from the brands a handler returns, and the client's
`rpc.isError` guard narrows a caught error's `.data` per name (see RpcErrorGuard).
*/
export type ErrorSpec = Record<string, { status: number; data?: StandardSchemaV1 }>
