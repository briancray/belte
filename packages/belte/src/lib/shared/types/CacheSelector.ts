import type { CacheOptions } from './CacheOptions.ts'
import type { RawRemoteFunction } from './RawRemoteFunction.ts'
import type { RemoteFunction } from './RemoteFunction.ts'

/*
Selector grammar shared by cache.invalidate(), pending(), and refreshing():
  undefined   → every entry
  remote fn   → that function's calls (method+url prefix); fn and fn.raw match
                the same set since they share wire identity
  producer fn → that producer's calls (reference-id prefix)
  { scope }   → any entry sharing one of the requested scope tags
*/
export type CacheSelector<Args, Return> =
    | RemoteFunction<Args, Return>
    | RawRemoteFunction<Args>
    | ((args?: Args) => Promise<Return>)
    /* Required-arg producer — its own arm because a required param isn't
       assignable to the optional one above under strictFunctionTypes. Selectors
       only read the producer's reference identity, never invoke it, so arity is
       immaterial to matching; this mirrors cache()'s required-arg overload so a
       producer keyable by cache() is equally selectable by pending()/refreshing()
       /invalidate(). Order-free: a union member can't hijack like an overload. */
    | ((args: Args) => Promise<Return>)
    | Pick<CacheOptions, 'scope'>
