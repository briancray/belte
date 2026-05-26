import type { RemoteFunction } from './RemoteFunction.ts'
import type { RemoteHandler } from './RemoteHandler.ts'
import type { StandardSchemaV1 } from './StandardSchemaV1.ts'

/*
Shared signature for every verb helper (GET / POST / …). Two overloads:

  - `Verb(fn, { schema })` — `Args` infers from `InferInput<Schema>`, the
    handler receives `InferOutput<Schema>`. Generic order is
    `<Return, Schema>` so users can override `Return` while letting
    `Schema` infer from `opts.schema`.
  - `Verb(fn)` — bare handler. `Args` and `Return` come from the handler
    type; `Return` is usually inferred via the `TypedResponse<T>` brand on
    `json`/`error`/`redirect`/`jsonl`/`sse`.
*/
export type VerbHelper = {
    <Return = unknown, Schema extends StandardSchemaV1 = StandardSchemaV1>(
        fn: RemoteHandler<StandardSchemaV1.InferOutput<Schema>, Return>,
        opts: { schema: Schema },
    ): RemoteFunction<StandardSchemaV1.InferInput<Schema>, Return>
    <Args = undefined, Return = unknown>(
        fn: RemoteHandler<Args, Return>,
    ): RemoteFunction<Args, Return>
}
