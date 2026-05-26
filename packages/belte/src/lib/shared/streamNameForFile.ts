/*
Translates a stream file path under `src/stream/` into the stream's
identity used on the wire. The name is the file path minus `.ts` so
nested paths (e.g. `orders/new.ts`) become `orders/new`. Streams don't
need a URL prefix the way routes do — they multiplex over the
framework-owned `/__belte/stream` ws and are dispatched by name in the
registry, not by HTTP path.
*/
export function streamNameForFile(relativePath: string): string {
    return relativePath.replace(/\.ts$/, '')
}
