import type { Stream, StreamOptions } from '../types/Stream.ts'

/*
Declares a Stream inside a file under `src/stream/`. Each file contains
exactly one export, named after the file (e.g. `chat.ts` →
`export const chat = stream<ChatMessage>(...)`). The bundler reads the
export name from the filename and the stream name from the file path
under `src/stream/`, then rewrites this call to bind the name into the
runtime implementation (defineStream on the server, streamProxy on the
client). Opts (history, clientPublish) live on the server side only;
the client target discards them.

This function exists only for the type signature; calling it directly
means the bundler plugin didn't process the file, which throws.
*/
export function stream<T = unknown>(_opts?: StreamOptions): Stream<T> {
    throw new Error(
        '[belte] `stream(...)` was called outside an $stream module — the stream helper is only valid as the value of `export const <filename> = ...` inside a file under src/stream/',
    )
}
