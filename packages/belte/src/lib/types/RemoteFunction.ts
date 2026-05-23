import type { HttpVerb } from './HttpVerb.ts'
import type { RemoteResponse } from './RemoteResponse.ts'

/*
Remote function reference returned by verb helpers and consumed by route
discovery, cache(), and direct calls. Has the same callable signature on
server and client — the bundler swaps the implementation for browser builds.
*/
export type RemoteFunction<Args, Return> = ((args: Args) => Promise<RemoteResponse<Return>>) & {
    readonly method: HttpVerb
    readonly url: string
    fetch(request: Request): Promise<RemoteResponse<Return>>
}
