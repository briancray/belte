import { HttpError } from './HttpError.ts'

/*
Builds the HttpError for a non-2xx response, parsing a typed-error body
(`{ $belteError, data }`, emitted by `error({ $belteError, status, data })` and
the validation 422) onto `.kind` / `.data`. Reads a clone so the original
`response.body` stays unread for callers that inspect it. A non-JSON or malformed
body leaves `.kind` / `.data` undefined (a plain `error(status, text)`). Shared by
the plain decode path (decodeResponse) and the streaming path (streamResponse) so
both surface the same typed error on a non-2xx.
*/
export async function httpErrorFor(response: Response): Promise<HttpError> {
    if ((response.headers.get('content-type') ?? '').toLowerCase().includes('json')) {
        try {
            const body = await response.clone().json()
            if (body !== null && typeof body === 'object' && '$belteError' in body) {
                return new HttpError(response, body.$belteError, body.data)
            }
        } catch {
            /* malformed JSON error body — fall through to a plain HttpError */
        }
    }
    return new HttpError(response)
}
