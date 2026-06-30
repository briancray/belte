/* True for the source-scanner whitespace set (space, tab, CR, LF). */
export function isAsciiWhitespace(c: string | undefined): boolean {
    return c === ' ' || c === '\t' || c === '\n' || c === '\r'
}
