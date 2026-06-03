import type { Server } from 'bun'
import { isStreamingResponse } from '../../shared/isStreamingResponse.ts'

/*
Opts a streaming response out of Bun's per-connection idle timeout. A stream
can stay quiet for longer than the 10s default between frames, which Bun would
otherwise read as an idle connection and close mid-stream. `server.timeout(req,
0)` clears the timeout for just this in-flight request, leaving the global
default in place for ordinary request/response traffic. Streaming is detected
by Content-Type (the shared signal the CLI/MCP drain paths use) rather than
`body instanceof ReadableStream`, since every bodied Response exposes one.
Non-stream responses pass through untouched.
*/
export function disableIdleTimeoutForStream(
    server: Server<unknown>,
    req: Request,
    response: Response,
): Response {
    if (isStreamingResponse(response)) {
        server.timeout(req, 0)
    }
    return response
}
