/*
Derives the server's error-prop contract — `{ status, message, stack }` — from
an unknown thrown value. Single-sources what both halves of the error boundary
encode: the server's renderPage catch and the client's showErrorView. A render
throw is always a 500; `message`/`stack` are read off an Error, else the value
is stringified and the stack omitted.
*/
export function errorParamsForThrow(error: unknown): {
    status: number
    message: string
    stack: string | undefined
} {
    return {
        status: 500,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
    }
}
