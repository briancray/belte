/*
Deep-copies a warm value so each reader gets its own mutable object — the
no-shared-mutation invariant the warm path turns on (a live fetch hands every
reader a fresh object; a warm read must match). A warm value only ever comes
from the snapshot's textual body kinds (warmValueFromSnapshot): json yields
JSON.parse output, text yields a string — the whole population is
JSON-round-trippable by construction (no Date/Map/Blob/cycle a structuredClone
would be needed for). A primitive (a string or scalar-json body) is immutable,
so it returns as-is with no copy; an object/array goes through a JSON round-trip,
measurably faster than structuredClone for this shape while producing the same
fresh, mutable copy.
*/
export function cloneWarmValue<T>(value: T): T {
    if (typeof value !== 'object' || value === null) {
        return value
    }
    return JSON.parse(JSON.stringify(value)) as T
}
