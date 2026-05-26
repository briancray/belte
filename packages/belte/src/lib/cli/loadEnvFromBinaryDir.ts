import { existsSync } from 'node:fs'
import { dirname } from 'node:path'

const ENV_LINE = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/

/*
Reads a `.env` next to the running binary (resolved via
`process.execPath`) and merges each declared var into `process.env`
only when not already set. The binary-dir `.env` is the file the
install tarball ships next to the executable; per-shell exports and
Bun's automatic CWD `.env` loading both naturally override it.

Strips surrounding single or double quotes off values; otherwise the
parser is intentionally minimal — no variable expansion, no escape
handling, no multi-line. Matches what the install tarball writes.
*/
export async function loadEnvFromBinaryDir(): Promise<void> {
    const binDir = dirname(process.execPath)
    const envPath = `${binDir}/.env`
    if (!existsSync(envPath)) {
        return
    }
    const text = await Bun.file(envPath).text()
    for (const line of text.split('\n')) {
        if (!line || line.startsWith('#')) {
            continue
        }
        const match = ENV_LINE.exec(line)
        if (!match) {
            continue
        }
        const [, key, rawValue] = match
        if (process.env[key as string] !== undefined) {
            continue
        }
        const trimmed = rawValue?.trim() ?? ''
        const unquoted =
            (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))
                ? trimmed.slice(1, -1)
                : trimmed
        process.env[key as string] = unquoted
    }
}
