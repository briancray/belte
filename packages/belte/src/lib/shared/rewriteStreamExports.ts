import {
    detectExportName,
    findCallEnd,
    isIdentPart,
    isIdentStart,
    matchCallTail,
} from './sourceTokenizer.ts'

type StreamSite = {
    exportName: string
    callStart: number
    parenStart: number
    parenEnd: number
}

/*
Scans a `$stream/**` module for its `export const <name> = stream(...)`
binding. Same tokenizer-driven approach as the route rewriter so a
`stream` mention in a docstring or template literal doesn't trip the
match. Each file must contain exactly one such export; the bundler
also checks that the export name matches the file's stem.
*/
function findStreamCallSite(source: string): StreamSite | undefined {
    let found: StreamSite | undefined
    const len = source.length
    let i = 0
    while (i < len) {
        const c = source[i]
        const next = source[i + 1]
        if (c === '/' && next === '/') {
            const newline = source.indexOf('\n', i + 2)
            i = newline === -1 ? len : newline + 1
            continue
        }
        if (c === '/' && next === '*') {
            const end = source.indexOf('*/', i + 2)
            i = end === -1 ? len : end + 2
            continue
        }
        if (c === '"' || c === "'") {
            i++
            while (i < len && source[i] !== c) {
                if (source[i] === '\\') {
                    i += 2
                    continue
                }
                if (source[i] === '\n') {
                    break
                }
                i++
            }
            i++
            continue
        }
        if (c === '`') {
            i++
            while (i < len && source[i] !== '`') {
                if (source[i] === '\\') {
                    i += 2
                    continue
                }
                i++
            }
            i++
            continue
        }
        if (isIdentStart(c) && !isIdentPart(source[i - 1])) {
            let j = i + 1
            while (j < len && isIdentPart(source[j])) {
                j++
            }
            const ident = source.slice(i, j)
            if (ident === 'stream') {
                const tail = matchCallTail(source, j)
                if (tail !== undefined) {
                    const exportName = detectExportName(source, i)
                    if (exportName !== undefined) {
                        if (found !== undefined) {
                            throw new Error(
                                '[belte] $stream module contains more than one `stream(...)` export — each file must declare exactly one stream',
                            )
                        }
                        const closeParen = findCallEnd(source, tail)
                        if (closeParen === undefined) {
                            throw new Error(
                                '[belte] $stream module has an unmatched `(` after the `stream` identifier',
                            )
                        }
                        found = {
                            exportName,
                            callStart: i,
                            parenStart: tail,
                            parenEnd: closeParen,
                        }
                        i = closeParen + 1
                        continue
                    }
                }
            }
            i = j
            continue
        }
        i++
    }
    return found
}

/*
Rewrites a `$stream/**` module for the server bundle: strips the user's
`stream` import and replaces the `stream(...)` call with the runtime
binding `__belteDefineStream__("<name>", opts)`. Handles both the
empty-opts case (no comma after the name) and the opts case (name +
comma + opts spliced through).
*/
export function rewriteStreamForServer(source: string, name: string): string {
    const stripped = stripStreamImport(source)
    const site = findStreamCallSite(stripped)
    if (!site) {
        return stripped
    }
    const inner = stripped.slice(site.parenStart + 1, site.parenEnd).trim()
    const binding =
        inner.length === 0
            ? `__belteDefineStream__(${JSON.stringify(name)})`
            : `__belteDefineStream__(${JSON.stringify(name)}, ${stripped.slice(site.parenStart + 1, site.parenEnd)})`
    return stripped.slice(0, site.callStart) + binding + stripped.slice(site.parenEnd + 1)
}

/*
Reads the module to discover the declared export name. The client
bundle uses this to emit a single proxy stub (streamProxy) — server-side
options (history, clientPublish) are discarded.
*/
export function extractStreamExport(source: string): { exportName: string } | undefined {
    const site = findStreamCallSite(source)
    if (!site) {
        return undefined
    }
    return { exportName: site.exportName }
}

function stripStreamImport(source: string): string {
    const pattern = /^\s*import\s*\{[^}]*\}\s*from\s*['"]belte\/stream['"]\s*;?\s*$/gm
    return source.replace(pattern, '')
}
