/* True when `c` can begin a JavaScript identifier (ASCII letters, `_`, `$`). Used by the
   opts-arg scanner (skipNonCode) to find identifiers and regex flags. */
export function isIdentStart(c: string | undefined): boolean {
    if (c === undefined) {
        return false
    }
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_' || c === '$'
}
