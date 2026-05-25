/*
Handler signature for verb-defined remote functions. Args is `undefined` for
GETs/DELETEs with no query, JSON-shaped objects for json bodies, and
form-shaped objects for form-encoded bodies. For binary or multipart bodies
Args is `undefined` — read the raw Request via `request()` from
`belte/server` instead.

Return is the value type the call site sees after Content-Type-driven
decoding (a parsed object for JSON, a string for text/*, a Blob otherwise,
`undefined` for 204). Returning a Response from the handler is still
required at runtime — the framework owns the wire layer; Return is what
the framework hands back to callers after decoding that Response.
*/
export type RemoteHandler<Args, _Return> = (args: Args) => Promise<Response> | Response
