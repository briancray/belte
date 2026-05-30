import type { BunPlugin } from 'bun'

type ExportEntry = string | { [condition: string]: ExportEntry }

/*
Walks a package.json `exports` entry, returning the first leaf string that
matches the supplied condition list in order. Returns undefined when no
branch resolves.
*/
function pickExport(entry: ExportEntry, conditions: string[]): string | undefined {
    if (typeof entry === 'string') {
        return entry
    }
    for (const condition of conditions) {
        if (entry[condition]) {
            const resolved = pickExport(entry[condition], conditions)
            if (resolved) {
                return resolved
            }
        }
    }
    return undefined
}

/*
Forces every `import 'svelte/...'` (from belte's own source, the consumer's
source, or any transitive dep) to resolve against the consumer app's svelte
install, picking the export condition that matches the build target.
Without this, belte's symlinked source can pick up a second svelte from its
install location, ship both runtimes, and break hydration. Shared by the
client build and the bundle connect-screen build.
*/
export function dedupeSveltePlugin({
    cwd,
    conditions,
}: {
    cwd: string
    conditions: string[]
}): BunPlugin {
    const consumerSvelte = `${cwd}/node_modules/svelte`
    return {
        name: 'belte-dedupe-svelte',
        async setup(build) {
            const pkgFile = Bun.file(`${consumerSvelte}/package.json`)
            if (!(await pkgFile.exists())) {
                return
            }
            const consumerPackage = (await pkgFile.json()) as {
                exports: Record<string, ExportEntry>
            }
            build.onResolve({ filter: /^svelte(\/.*)?$/ }, (args) => {
                const subpath =
                    args.path === 'svelte' ? '.' : `.${args.path.slice('svelte'.length)}`
                const entry = consumerPackage.exports[subpath]
                if (!entry) {
                    return undefined
                }
                const resolvedFile = pickExport(entry, conditions)
                if (!resolvedFile) {
                    return undefined
                }
                return { path: `${consumerSvelte}/${resolvedFile.replace(/^\.\//, '')}` }
            })
        },
    }
}
