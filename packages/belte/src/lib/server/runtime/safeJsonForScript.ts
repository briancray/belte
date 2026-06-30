/*
Escapes characters that could prematurely terminate the surrounding <script>
tag or be interpreted as HTML comment delimiters when a JSON literal is
inlined into an HTML document. U+2028 (LS) and U+2029 (PS) are valid in JSON
but break a `<script>` tag's inline content because the JavaScript lexer
treats them as line terminators; encode them as Unicode escapes.
*/
const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

/* Built from char codes so no raw U+2028/U+2029 (invisible line terminators)
   sit in this source. */
const ESCAPES = new Map([
    ['<', '\\u003c'],
    ['-->', '--\\u003e'],
    [LINE_SEPARATOR, '\\u2028'],
    [PARAGRAPH_SEPARATOR, '\\u2029'],
])
const UNSAFE = new RegExp(`<|-->|${LINE_SEPARATOR}|${PARAGRAPH_SEPARATOR}`, 'g')

/* One pass over the (potentially large) serialized payload instead of four
   sequential scans. The targets don't destructively overlap — `-->` carries no
   `<`, and alternation is tried left-to-right at each index — so a single
   replacer reproduces the per-pass result byte for byte (see test). */
export function safeJsonForScript(value: unknown): string {
    return JSON.stringify(value).replace(UNSAFE, (match) => ESCAPES.get(match) ?? match)
}
