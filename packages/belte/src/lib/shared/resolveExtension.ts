// node:fs existsSync/statSync — Bun plugin onResolve is sync-only; Bun.file().exists() is async
import { existsSync, statSync } from 'node:fs'

/*
Resolves a bare directory or extensionless path to a concrete file. Mirrors
Node-style resolution (path.ts, path.js, path/index.ts, path/index.js) so
project code can use SvelteKit-style aliases like `$shared/foo/utils` that point
at directories with an index file. The (path → resolved) mapping is
deterministic per build, so cache it — every module that imports a `$shared`
alias hits this twice or more, and each call would otherwise do up to nine
filesystem stats.
*/
const resolveExtensionCache = new Map<string, string>()
export function resolveExtension(path: string): string {
    const cached = resolveExtensionCache.get(path)
    if (cached !== undefined) {
        return cached
    }
    const resolved = resolveExtensionUncached(path)
    resolveExtensionCache.set(path, resolved)
    return resolved
}

const RESOLVE_EXTENSIONS = ['.ts', '.js', '.tsx', '.jsx']

function resolveExtensionUncached(path: string): string {
    if (existsSync(path) && !statSync(path).isDirectory()) {
        return path
    }
    for (const extension of RESOLVE_EXTENSIONS) {
        if (existsSync(`${path}${extension}`)) {
            return `${path}${extension}`
        }
    }
    for (const extension of RESOLVE_EXTENSIONS) {
        const indexPath = `${path}/index${extension}`
        if (existsSync(indexPath)) {
            return indexPath
        }
    }
    return path
}
