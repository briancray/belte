/* Normalizes a tags list to a Set for O(1) membership. */
export function toTagSet(tags: string[]): Set<string> {
    return new Set(tags)
}
