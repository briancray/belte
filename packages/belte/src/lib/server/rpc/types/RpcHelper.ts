import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { ErrorSpec } from '../../../shared/types/ErrorSpec.ts'
import type { RemoteFunction } from '../../../shared/types/RemoteFunction.ts'
import type { StandardSchemaV1 } from '../../../shared/types/StandardSchemaV1.ts'
import type { TypedError } from './TypedError.ts'
import type { TypedResponse } from './TypedResponse.ts'

/*
The success body carried by a handler's return type `R`. Error branches
(`TypedError`, checked first since they're also Responses) drop to `never` and
union away, so `Return` is the body of the success `TypedResponse` members alone
— an untagged `Response` falls back to `unknown`, matching hand-built responses.
*/
type SuccessBody<R> = R extends TypedError<string, ErrorSpec[string]>
    ? never
    : R extends TypedResponse<infer Body>
      ? Body
      : unknown

/*
The error spec a handler's return type `R` declares — rebuilt name→entry from the
`TypedError` brands among its branches (distributes over the union; no error
branches → `{}`). This is what gives `rpc.isError` its typed surface with no
`errors:` option: the errors a handler RETURNS are the errors it can raise.
*/
type ErrorBrand<R> = R extends TypedError<infer Name, infer Entry>
    ? { name: Name; entry: Entry }
    : never
type InferredErrors<R> = { [Brand in ErrorBrand<R> as Brand['name']]: Brand['entry'] }

/*
Shared signature for every rpc helper (GET / POST / …). The handler's return
type is inferred whole (`R`), then split: `SuccessBody<R>` becomes the caller's
`Return`, `InferredErrors<R>` becomes the rpc's `Errors` (driving `isError`).
Four overloads by argument source:

  - `Rpc(fn, { inputSchema, filesSchema, … })` — multipart upload. The handler
    receives the text fields (`InferOutput<InputSchema>`) intersected with the
    validated File parts (`InferOutput<FilesSchema>`). The call site sends a
    FormData (RemoteFunction's call accepts it). filesSchema stays off the
    JSON-Schema projection — a File has no honest conversion — so only
    inputSchema feeds MCP/CLI/OpenAPI.
  - `Rpc(fn, { inputSchema, … })` — `Args` infers from `InferInput<InputSchema>`,
    the handler receives `InferOutput<InputSchema>`. `outputSchema` is an
    optional Standard Schema for the success body — it feeds the OpenAPI 200
    response and the MCP tool `outputSchema`. `clients` controls which surfaces
    expose this rpc. `crossOrigin: true` exempts a mutating rpc from the router's
    same-origin CSRF gate. `maxBodySize` caps the body's received bytes (413).
    `timeout` (ms) bounds the handler on every surface (a 504), and on the
    network path aborts request().signal so an in-flight fetch is cancelled.
  - `Rpc(fn, { clients })` — schemaless but with explicit client targeting.
  - `Rpc(fn)` — bare handler. `Args` comes from the handler param.
*/
export type RpcHelper = {
    <
        R extends Response,
        InputSchema extends StandardSchemaV1 = StandardSchemaV1,
        FilesSchema extends StandardSchemaV1 = StandardSchemaV1,
    >(
        fn: (
            args: StandardSchemaV1.InferOutput<InputSchema> &
                StandardSchemaV1.InferOutput<FilesSchema>,
        ) => R | Promise<R>,
        opts: {
            inputSchema: InputSchema
            filesSchema: FilesSchema
            outputSchema?: StandardSchemaV1
            clients?: Partial<ClientFlags>
            crossOrigin?: boolean
            maxBodySize?: number
            timeout?: number
        },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, SuccessBody<R>, InferredErrors<R>>
    <R extends Response, InputSchema extends StandardSchemaV1 = StandardSchemaV1>(
        fn: (args: StandardSchemaV1.InferOutput<InputSchema>) => R | Promise<R>,
        opts: {
            inputSchema: InputSchema
            outputSchema?: StandardSchemaV1
            clients?: Partial<ClientFlags>
            crossOrigin?: boolean
            maxBodySize?: number
            timeout?: number
        },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, SuccessBody<R>, InferredErrors<R>>
    <Args = undefined, R extends Response = Response>(
        fn: (args: Args) => R | Promise<R>,
        opts: {
            outputSchema?: StandardSchemaV1
            clients?: Partial<ClientFlags>
            crossOrigin?: boolean
            maxBodySize?: number
            timeout?: number
        },
    ): RemoteFunction<Args, SuccessBody<R>, InferredErrors<R>>
    <Args = undefined, R extends Response = Response>(
        fn: (args: Args) => R | Promise<R>,
    ): RemoteFunction<Args, SuccessBody<R>, InferredErrors<R>>
}
