/*
What a typed-error constructor returns: a plain descriptor (NOT a Response), so it
flows through the single `error()` funnel. `error()` reads `status` off it and
serializes `{ $belteError: name, data }` as the body. The client parses that body
back onto `HttpError.kind` / `.data`.
*/
export type ErrorDescriptor<Name extends string = string, Data = unknown> = {
    readonly $belteError: Name
    readonly status: number
    readonly data: Data
}
