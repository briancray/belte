/*
Parses a PORT env value into a usable TCP port, returning undefined for
missing, empty, or out-of-range/non-integer input so the caller can fall back
to a default. A bare Number() turns '' into 0 (a random kernel-assigned port)
and 'abc' into NaN, both silently wrong; this rejects them instead.
*/
export function parsePort(value: string | undefined): number | undefined {
    if (value === undefined || value.trim() === '') {
        return undefined
    }
    const port = Number(value)
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        return undefined
    }
    return port
}
