/*
Stable JSON stringify: object keys are sorted recursively so equivalent values
produce identical strings regardless of insertion order. Non-JSON values
(functions, symbols) are dropped the same way native JSON.stringify drops them.
Used to derive deterministic cache keys from explicit-key overrides and from
auto-keyed POST/PUT/PATCH bodies.
*/
export function canonicalJson(value: unknown): string {
    return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
    if (value === null || typeof value !== 'object') {
        return value
    }
    if (Array.isArray(value)) {
        return value.map(canonicalize)
    }
    const record = value as Record<string, unknown>
    return Object.keys(record)
        .toSorted()
        .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = canonicalize(record[key])
            return acc
        }, {})
}
