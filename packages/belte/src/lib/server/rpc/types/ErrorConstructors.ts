import type { ErrorSpec } from '../../../shared/types/ErrorSpec.ts'
import type { StandardSchemaV1 } from '../../../shared/types/StandardSchemaV1.ts'
import type { TypedResponse } from './TypedResponse.ts'

/*
The callable error constructors `errors(spec)` returns. An entry with a `data`
schema makes its constructor require that schema's inferred input; an entry
without one is nullary. Each returns a `TypedResponse<never>` (the serialized
error Response) the handler returns directly.
*/
export type ErrorConstructors<Spec extends ErrorSpec> = {
    [Name in keyof Spec & string]: Spec[Name]['data'] extends StandardSchemaV1
        ? (data: StandardSchemaV1.InferInput<Spec[Name]['data']>) => TypedResponse<never>
        : () => TypedResponse<never>
}
