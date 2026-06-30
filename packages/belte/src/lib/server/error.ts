import { NO_STORE } from '../shared/CACHE_CONTROL_VALUES.ts'
import type { ErrorDescriptor } from '../shared/types/ErrorDescriptor.ts'
import type { TypedResponse } from './rpc/types/TypedResponse.ts'
import { STATUS_TEXT } from './runtime/STATUS_TEXT.ts'
import { typedErrorResponse } from './runtime/typedErrorResponse.ts'
import { withResponseDefaults } from './runtime/withResponseDefaults.ts'

/*
Plain-text error Response — clearer than constructing a Response by
hand with a status and a text body, and shaped so the client's
HttpError carries the message verbatim (`HttpError.response.text()`
returns the message, no parsing).

  if (!order) return error(404, 'order not found')

`message` defaults to the status's standard reason phrase when
omitted (e.g. `error(404)` body = 'Not Found'). The body is
text/plain so intermediaries don't try to render or sniff it. A final
`ResponseInit` adds headers (e.g. `Retry-After` on a 429); the positional
`status` always wins over any `init.status`.

To short-circuit a handler instead of returning, `throw new Error(...)`
or `throw new HttpError(error(...))` — the framework's `app.handleError`
hook catches thrown errors. This helper deliberately returns a Response
rather than throwing one so a single `return error(...)` is the
expected pattern, with the same control flow as `return json(...)`.
*/

/*
Body type is `never` because `error()` only travels the non-2xx path on
the wire — the caller's `await fn(args)` throws `HttpError` and never
resolves to this response's body. Returning a TypedResponse<never> lets
the union of branches in a handler narrow to whatever the success
branch carries (`TypedResponse<{user}> | TypedResponse<never>` → Return
= {user}).
*/
// @readme response
export function error(status: number, message?: string, init?: ResponseInit): TypedResponse<never>
export function error(descriptor: ErrorDescriptor): TypedResponse<never>
export function error(
    statusOrDescriptor: number | ErrorDescriptor,
    message?: string,
    init?: ResponseInit,
): TypedResponse<never> {
    /*
    Descriptor form (`error({ $belteError, status, data })`): a typed error
    serialized as a `{ $belteError, data }` JSON body. The reason phrase is set
    as statusText so it reaches `HttpError.statusText` on the client; the client
    parses the body back onto `HttpError.kind` / `.data` (httpErrorFor).
    */
    if (typeof statusOrDescriptor === 'object') {
        const descriptor = statusOrDescriptor
        return typedErrorResponse(descriptor.$belteError, descriptor.status, descriptor.data)
    }
    const status = statusOrDescriptor
    const body = message ?? STATUS_TEXT[status] ?? `HTTP ${status}`
    return new Response(
        body,
        withResponseDefaults(
            init,
            {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': NO_STORE,
            },
            status,
        ),
    ) as TypedResponse<never>
}
