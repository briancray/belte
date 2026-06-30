/*
Returns a promise that resolves to a fresh clone of the underlying Response.
Multiple readers can each consume the body independently — the stored
promise's Response is never consumed directly, so clones always succeed.
*/
export function shareableResponse(promise: Promise<Response>): Promise<Response> {
    return promise.then((response) => response.clone())
}
