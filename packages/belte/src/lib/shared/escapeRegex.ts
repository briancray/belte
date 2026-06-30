/* Escapes a literal string for safe interpolation into a RegExp source. */
export function escapeRegex(value: string): string {
    return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}
