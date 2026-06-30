import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { ErrorSpec } from '../../../shared/types/ErrorSpec.ts'
import type { RemoteFunction } from '../../../shared/types/RemoteFunction.ts'
import type { StandardSchemaV1 } from '../../../shared/types/StandardSchemaV1.ts'
import type { ErrorSet } from './ErrorSet.ts'
import type { RemoteHandler } from './RemoteHandler.ts'

/*
Shared signature for every rpc helper (GET / POST / …). Three overloads:

  - `Rpc(fn, { inputSchema, outputSchema?, clients? })` — `Args` infers
    from `InferInput<InputSchema>`, the handler receives
    `InferOutput<InputSchema>`. Generic order is `<Return, InputSchema>` so
    users can override `Return` while letting `InputSchema` infer from
    `opts.inputSchema`. `outputSchema` is an optional Standard Schema for
    the success body — it feeds the OpenAPI 200 response and the MCP tool
    `outputSchema`. JSON Schema is projected from each schema's own
    `toJSONSchema()` (wrap with withJsonSchema if the library lacks one).
    `clients` controls which surfaces (browser / mcp / cli) expose this rpc.
    `crossOrigin: true` exempts a mutating rpc from the router's same-origin
    CSRF gate — by default a browser request whose Origin doesn't match the
    app's own host is refused with 403 on every non-GET/HEAD rpc.
    `maxBodySize` caps the body's actual received bytes (413 past it),
    enforced before parsing; omitted, the only ceiling is Bun.serve's
    server-wide maxRequestBodySize. `timeout` (ms) bounds the handler's
    execution on every surface (SSR / MCP / CLI / network) — a 504 once
    exceeded; on the network path it also aborts request().signal so a
    handler's `fetch(ext, { signal: request().signal })` is cancelled, not
    just abandoned.
  - `Rpc(fn, { clients })` — schemaless but with explicit client
    targeting (e.g. server-internal RPC with `clients: { browser: false }`).
  - `Rpc(fn)` — bare handler. `Args` and `Return` come from the handler
    type; `Return` is usually inferred via the `TypedResponse<T>` brand on
    `json`/`error`/`redirect`/`jsonl`/`sse`.
*/
export type RpcHelper = {
    /*
    `Rpc(fn, { inputSchema, filesSchema, … })` — multipart upload. The
    handler receives the text fields (`InferOutput<InputSchema>`) intersected
    with the validated File parts (`InferOutput<FilesSchema>`); both are merged
    into one args bag. The call site sends a FormData (RemoteFunction's call
    accepts it), since a File can't ride a JSON body. filesSchema stays off the
    JSON-Schema projection — a File has no honest conversion (see
    jsonSchemaForSchema) — so only inputSchema feeds MCP/CLI/OpenAPI.
    */
    <
        Return = unknown,
        InputSchema extends StandardSchemaV1 = StandardSchemaV1,
        FilesSchema extends StandardSchemaV1 = StandardSchemaV1,
        Errors extends ErrorSpec = Record<string, never>,
    >(
        fn: RemoteHandler<
            StandardSchemaV1.InferOutput<InputSchema> & StandardSchemaV1.InferOutput<FilesSchema>,
            Return
        >,
        opts: {
            inputSchema: InputSchema
            filesSchema: FilesSchema
            outputSchema?: StandardSchemaV1
            errors?: ErrorSet<Errors>
            clients?: Partial<ClientFlags>
            crossOrigin?: boolean
            maxBodySize?: number
            timeout?: number
        },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, Return, Errors>
    <
        Return = unknown,
        InputSchema extends StandardSchemaV1 = StandardSchemaV1,
        Errors extends ErrorSpec = Record<string, never>,
    >(
        fn: RemoteHandler<StandardSchemaV1.InferOutput<InputSchema>, Return>,
        opts: {
            inputSchema: InputSchema
            outputSchema?: StandardSchemaV1
            errors?: ErrorSet<Errors>
            clients?: Partial<ClientFlags>
            crossOrigin?: boolean
            maxBodySize?: number
            timeout?: number
        },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, Return, Errors>
    <Args = undefined, Return = unknown, Errors extends ErrorSpec = Record<never, never>>(
        fn: RemoteHandler<Args, Return>,
        opts: {
            outputSchema?: StandardSchemaV1
            errors?: ErrorSet<Errors>
            clients?: Partial<ClientFlags>
            crossOrigin?: boolean
            maxBodySize?: number
            timeout?: number
        },
    ): RemoteFunction<Args, Return, Errors>
    <Args = undefined, Return = unknown>(
        fn: RemoteHandler<Args, Return>,
    ): RemoteFunction<Args, Return>
}
