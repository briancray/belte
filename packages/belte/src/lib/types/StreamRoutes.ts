import type { Stream } from './Stream.ts'

/*
Manifest of stream-name → module loader. Produced by the resolver
plugin from each `.ts` under src/stream/. Each module has exactly one
named export, a Stream whose `.name` was stamped in by the bundler
rewrite. The dispatcher imports a module on first access and caches the
resolved Stream against its name.
*/
export type StreamRoutes = Record<string, () => Promise<Record<string, Stream<unknown>>>>
