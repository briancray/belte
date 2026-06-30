import { describe, expect, test } from 'bun:test'
import { safeJsonForScript } from '../src/lib/server/runtime/safeJsonForScript.ts'

const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)

describe('safeJsonForScript', () => {
    test('escapes < so a payload cannot open or close a tag', () => {
        expect(safeJsonForScript('</script>')).toBe('"\\u003c/script>"')
    })

    test('escapes the --> HTML comment close', () => {
        expect(safeJsonForScript('a-->b')).toBe('"a--\\u003eb"')
    })

    test('escapes the U+2028 / U+2029 line terminators', () => {
        expect(safeJsonForScript(`a${LS}b${PS}c`)).toBe('"a\\u2028b\\u2029c"')
    })

    test('handles adjacent and overlapping escape targets identically to per-pass replacement', () => {
        for (const input of ['<-->', '--><', '--->', `<${LS}-->${PS}`, '<<-->>']) {
            const expected = JSON.stringify(input)
                .replace(/</g, '\\u003c')
                .replace(/-->/g, '--\\u003e')
                .replaceAll(LS, '\\u2028')
                .replaceAll(PS, '\\u2029')
            expect(safeJsonForScript(input)).toBe(expected)
        }
    })

    test('leaves a clean payload untouched', () => {
        expect(safeJsonForScript({ a: 1, b: 'hi' })).toBe('{"a":1,"b":"hi"}')
    })
})
