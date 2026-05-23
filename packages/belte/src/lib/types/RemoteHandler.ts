import type { RemoteResponse } from './RemoteResponse.ts'

/*
Handler signature for verb-defined remote functions. Args is `undefined` for
GETs/DELETEs with no query, JSON-shaped objects for json bodies, and
form-shaped objects for form-encoded bodies. Args is `undefined` for binary
or multipart bodies — the handler reads from `request` directly.
*/
export type RemoteHandler<Args, Return> = (
    args: Args,
    request: Request,
) => Promise<RemoteResponse<Return> | Response> | RemoteResponse<Return> | Response
