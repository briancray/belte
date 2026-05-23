import type { RemoteFunction } from './RemoteFunction.ts'

/*
Manifest of route URL → verb-keyed map of handler loaders. Produced by the
resolver plugin from endpoint.ts files. Each verb may be present or absent
depending on what the module exports.
*/
export type RemoteRoutes = Record<
    string,
    () => Promise<Record<string, RemoteFunction<unknown, unknown> | undefined>>
>
