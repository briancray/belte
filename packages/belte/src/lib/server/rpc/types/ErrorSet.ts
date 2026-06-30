import type { ErrorSpec } from '../../../shared/types/ErrorSpec.ts'
import type { ERROR_SPEC } from './ERROR_SPEC.ts'
import type { ErrorConstructors } from './ErrorConstructors.ts'

/*
What `errors(spec)` returns: the callable constructor set, branded at the type
level with its `Spec`. The brand drives `Errors` inference at the rpc `errors:`
option, which flows to `RemoteFunction` for client `rpc.isError`. Phantom — never
assigned at runtime; the factory's declared return type is its only home.
*/
export type ErrorSet<Spec extends ErrorSpec> = ErrorConstructors<Spec> & {
    readonly [ERROR_SPEC]?: Spec
}
