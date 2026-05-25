import { HttpError } from './HttpError.ts'

/*
Decodes a Response into the natural body value based on Content-Type:
  application/json (or `*\/+json`) → parsed JSON
  text/*                           → string
  204 No Content / empty body      → undefined
  everything else                  → Blob

Non-2xx responses throw HttpError so the happy path never has to check
`.ok` — error handling moves into try/catch (or unhandled exception
propagation), and the success path types as Promise<Return> cleanly.

Callers that need headers, streaming, or per-status branching should use
the `.raw(args)` escape hatch on the remote function instead — that
returns the underlying Response untouched.
*/
export async function decodeResponse(response: Response): Promise<unknown> {
    if (!response.ok) {
        throw new HttpError(response)
    }
    if (response.status === 204) {
        return undefined
    }
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    if (contentType.includes('json')) {
        return response.json()
    }
    if (contentType.startsWith('text/')) {
        return response.text()
    }
    return response.blob()
}
