import type { TypedResponse } from './TypedResponse.ts'

/*
A server rpc handler: takes the parsed/validated `args` and returns a
`TypedResponse<Return>` (sync or async). Typed errors are raised by returning a
constructor call from a module-scope `errors(spec)` set — there is no `ctx` param.
*/
export type RemoteHandler<Args, Return> = (
    args: Args,
) => TypedResponse<Return> | Promise<TypedResponse<Return>>
