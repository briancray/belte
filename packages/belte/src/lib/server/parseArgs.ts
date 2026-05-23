import type { HttpVerb } from '../types/HttpVerb.ts'

/*
Content-type-driven argument parsing for a server-side handler. Returns the
parsed args object or undefined when no args can be derived. Mirrors the
client proxy's serialization so the same handler signature works either way.
*/
export async function parseArgs(method: HttpVerb, request: Request): Promise<unknown> {
    if (method === 'GET' || method === 'DELETE') {
        const url = new URL(request.url)
        if (url.search === '' || url.search === '?') {
            return undefined
        }
        return Object.fromEntries(url.searchParams)
    }
    const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
    if (contentType.includes('application/json')) {
        const text = await request.text()
        if (text === '') {
            return undefined
        }
        return JSON.parse(text)
    }
    if (
        contentType.includes('application/x-www-form-urlencoded') ||
        contentType.includes('multipart/form-data')
    ) {
        const form = await request.formData()
        return Object.fromEntries(form)
    }
    return undefined
}
