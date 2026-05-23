import type { TypedResponse } from './TypedResponse.ts'

declare const remoteBrand: unique symbol

/*
Branded Response variant only verb helpers can produce. The brand lets cache()
reject non-remote promises at compile time so users can't accidentally hand it
a bare fetch() promise — the WeakMap key derivation depends on metadata that
only the verb helpers populate.
*/
export type RemoteResponse<T> = TypedResponse<T> & {
    readonly [remoteBrand]: true
}
