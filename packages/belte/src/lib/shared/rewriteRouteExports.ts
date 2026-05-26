import type { HttpVerb } from '../types/HttpVerb.ts'
import { detectExportName, isIdentPart, isIdentStart, matchCallTail } from './sourceTokenizer.ts'

const VERB_NAMES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
const VERB_SET = new Set<string>(VERB_NAMES)

type RpcSite = {
    verb: HttpVerb
    exportName: string
    callStart: number
    parenStart: number
}

/*
Scans an `$route/**` module and locates its `export const <name> = VERB(...)`
binding. Returns the verb, the export name, and the byte range of the
`VERB(` call so the rewriters can splice in the runtime implementation.
Verb is the identifier itself (`GET`/`POST`/…); the export name comes from
the surrounding `export const <name> = ` binding.

A regex pass would be tidier but it can't tell a `GET` mention inside a
docstring or template literal from the real call, and it can't follow
nested generics like `GET<Map<K, V>>(`.

Each file must contain exactly one such export; the bundler also checks
that the export name matches the file's stem so the URL (file path) and
the call-site name stay aligned.
*/
function findRpcCallSite(source: string): RpcSite | undefined {
    let found: RpcSite | undefined
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
            if (VERB_SET.has(ident)) {
                const tail = matchCallTail(source, j)
                if (tail !== undefined) {
                    const exportName = detectExportName(source, i)
                    if (exportName !== undefined) {
                        if (found !== undefined) {
                            throw new Error(
                                '[belte] $route module contains more than one `<VERB>(...)` export — each file must declare exactly one remote function',
                            )
                        }
                        found = {
                            verb: ident as HttpVerb,
                            exportName,
                            callStart: i,
                            parenStart: tail,
                        }
                        i = tail + 1
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
Rewrites an `$route/**` module for the server bundle: strips the verb import
line and replaces the `<VERB>(` call with the runtime constructor binding
— `__belteDefineVerb__("VERB", "<url>", `. Generics on the call are
discarded; the verb/url come from the file path + identifier instead.
*/
export function rewriteForServer(source: string, url: string): string {
    const stripped = stripRpcImport(source)
    const site = findRpcCallSite(stripped)
    if (!site) {
        return stripped
    }
    const binding = `__belteDefineVerb__(${JSON.stringify(site.verb)}, ${JSON.stringify(url)}, `
    return stripped.slice(0, site.callStart) + binding + stripped.slice(site.parenStart + 1)
}

/*
Reads the module to discover the declared verb and export name without
emitting any rewritten source. The client bundle uses this to emit a
single proxy stub (remoteProxy) with the same export name the source
declared.
*/
export function extractRouteExport(
    source: string,
): { verb: HttpVerb; exportName: string } | undefined {
    const site = findRpcCallSite(source)
    if (!site) {
        return undefined
    }
    return { verb: site.verb, exportName: site.exportName }
}

function stripRpcImport(source: string): string {
    const pattern = /^\s*import\s*\{[^}]*\}\s*from\s*['"]belte\/route['"]\s*;?\s*$/gm
    return source.replace(pattern, '')
}
