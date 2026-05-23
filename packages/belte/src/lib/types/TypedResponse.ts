/*
Response whose json() is typed to T. Returned by Response.json with inference
flowing from the handler's return value through to the proxy's .json() call.
*/
export interface TypedResponse<T> extends Response {
    json(): Promise<T>
}
