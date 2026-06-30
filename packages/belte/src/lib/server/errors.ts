import type { ErrorSpec } from '../shared/types/ErrorSpec.ts'
import type { ErrorSet } from './rpc/types/ErrorSet.ts'
import { typedErrorResponse } from './runtime/typedErrorResponse.ts'

/*
Declares a reusable, typed set of errors for one or more rpcs. Each spec entry
(`{ status, data? }`) becomes a constructor: with a `data` schema it requires that
input, without one it's nullary. A constructor returns the serialized error
`Response` directly (`return orderErrors.invalidCoupon({ code }))`), so no `error()`
wrapper is needed. Pass the same object to the rpc `errors:` option — its declared
type carries the spec so `Errors` infers and the client's `rpc.isError(e, 'name')`
narrows `.kind` / `.data`.
*/
// @readme errors
export function errors<const Spec extends ErrorSpec>(spec: Spec): ErrorSet<Spec> {
    const entries = Object.entries(spec).map(([name, { status }]) => [
        name,
        (data?: unknown) => typedErrorResponse(name, status, data),
    ])
    return Object.fromEntries(entries) as ErrorSet<Spec>
}
