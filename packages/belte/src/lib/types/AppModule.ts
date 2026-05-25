import type { Server, WebSocketHandler } from 'bun'
import type { SocketData } from './App.ts'

/*
Optional hooks exported from src/app.ts. All hooks are optional; defaults
kick in when an export is missing. init returns an optional cleanup function
that runs on SIGINT/SIGTERM. handle is single-middleware with next so user
code can mutate the response or branch on the URL. socket is Bun's standard
WS shape. Inside request scopes, the live Bun.Server is reachable via the
exported `server` proxy from `belte/server`; `init` and `socket.upgrade`
receive it explicitly because they run outside a request. The WebSocket
payload type comes from the global Belte.Register hook (see SocketData) —
projects that don't augment get `unknown`.
*/
export type AppModule = {
    init?: (ctx: {
        server: Server<SocketData>
    }) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>
    handle?: (
        request: Request,
        next: (req: Request) => Promise<Response>,
    ) => Promise<Response> | Response
    handleError?: (error: unknown, request: Request) => Promise<Response> | Response
    socket?: WebSocketHandler<SocketData> & {
        upgrade?: (
            req: Request,
            ctx: { server: Server<SocketData> },
        ) =>
            | { data: SocketData; headers?: Record<string, string> }
            | false
            | Promise<{ data: SocketData; headers?: Record<string, string> } | false>
    }
}
