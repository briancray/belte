import type { HttpVerb } from '../types/HttpVerb.ts'

/*
Metadata recorded by verb helpers (server and client proxy) for every call.
The cache layer reads `request` from this WeakMap to populate the entry's
stored request without re-building it. `key`, `method`, and `url` are
included for parity with the stored entry shape but are derivable from the
RemoteFunction itself, so cache() recomputes its own key independently.
*/
export type RemoteMeta = {
    key: string
    method: HttpVerb
    url: string
    request: Request
}

const meta = new WeakMap<Promise<unknown>, RemoteMeta>()

export function recordRemoteMeta(promise: Promise<unknown>, value: RemoteMeta): void {
    meta.set(promise, value)
}

export function getRemoteMeta(promise: Promise<unknown>): RemoteMeta | undefined {
    return meta.get(promise)
}
