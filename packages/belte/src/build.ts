import type { BunPlugin } from 'bun'
import { belteResolverPlugin } from './belteResolverPlugin.ts'
import { dedupeSveltePlugin } from './dedupeSveltePlugin.ts'
import { exitOnBuildFailure } from './lib/shared/exitOnBuildFailure.ts'
import { isModuleNotFound } from './lib/shared/isModuleNotFound.ts'
import { loadSvelteConfig } from './lib/shared/loadSvelteConfig.ts'
import { log } from './lib/shared/log.ts'
import type { SvelteConfig } from './lib/shared/types/SvelteConfig.ts'
import { sveltePlugin } from './sveltePlugin.ts'

const CLIENT_ENTRY = new URL('./clientEntry.ts', import.meta.url).pathname

/*
Builds the client-side bundle into `${cwd}/dist/_app`. Clears the dist
directory first, then runs Bun.build with the svelte-dedupe plugin, the
svelte loader, the virtual-module resolver, and (optionally) Tailwind.
When `compress`, each emitted file is also written as a zstd-compressed
`.zst` sibling (level 22 — paid once at build time) so the server can
stream the precompressed bytes directly when the client supports it, and
decompress on the fly for older clients. Dev skips compression (zstd-22 on
every rebuild dwarfs the bundle itself) — the server falls back to serving
the plain bytes when no `.zst` sibling exists.

Returns whether the build succeeded. On failure it prints the diagnostics
and, by default, exits the process (one-shot `belte build` / `compile`).
The dev orchestrator passes `exitOnFailure: false` so a syntax error keeps
the loop (and the last-good server) alive instead of tearing it down.
*/
export async function build({
    cwd = process.cwd(),
    svelteConfig,
    minify = true,
    compress = true,
    exitOnFailure = true,
}: {
    cwd?: string
    svelteConfig?: SvelteConfig
    minify?: boolean
    compress?: boolean
    exitOnFailure?: boolean
} = {}): Promise<boolean> {
    const distDir = `${cwd}/dist`
    const outDir = `${distDir}/_app`

    // shell-rm is the impure boundary for "clear dist" — Bun.$ is first-party
    await Bun.$`rm -rf ${distDir}`.quiet()

    const config = svelteConfig ?? (await loadSvelteConfig(cwd))
    const plugins: BunPlugin[] = [
        dedupeSveltePlugin({ cwd, conditions: ['browser', 'default'] }),
        sveltePlugin({ generate: 'client', svelteConfig: config }),
        belteResolverPlugin({ cwd, target: 'client' }),
    ]
    try {
        const tailwind = (await import('bun-plugin-tailwind')).default
        plugins.push(tailwind)
    } catch (error) {
        /*
        Tailwind is an optional peer — a genuine "not installed" is fine and
        builds without it. But only swallow the module-resolution failure;
        any other error (a plugin that loaded and then threw on a real
        misconfig) must surface, or the build silently ships unstyled.
        */
        if (!isModuleNotFound(error)) {
            throw error
        }
        log.warn('bun-plugin-tailwind not installed; building without Tailwind')
    }

    const result = await Bun.build({
        entrypoints: [CLIENT_ENTRY],
        outdir: outDir,
        target: 'browser',
        splitting: true,
        minify,
        sourcemap: 'linked',
        naming: {
            entry: 'client-[hash].[ext]',
            chunk: '[name]-[hash].[ext]',
            asset: '[name].[ext]',
        },
        plugins,
    })

    if (!result.success) {
        if (exitOnFailure) {
            exitOnBuildFailure(result)
        }
        result.logs.forEach((entry) => {
            log.error(entry)
        })
        return false
    }

    // Dev skips the zstd siblings; report the bundle and let the watcher restart.
    if (!compress) {
        log.success(`wrote ${result.outputs.length} files to ${outDir}`)
        return true
    }

    const compressedByteLengths = await Promise.all(
        result.outputs.map(async (output) => {
            const bytes = await Bun.file(output.path).bytes()
            const compressed = await Bun.zstdCompress(bytes, { level: 22 })
            await Bun.write(`${output.path}.zst`, compressed)
            return compressed.byteLength
        }),
    )
    const compressedBytes = compressedByteLengths.reduce((total, length) => total + length, 0)

    log.success(
        `wrote ${result.outputs.length} files to ${outDir} (+${result.outputs.length} .zst, ${(compressedBytes / 1024).toFixed(1)} KiB total)`,
    )
    // Per-file paths are noise at startup; surface them only under DEBUG=belte:build.
    result.outputs.forEach((output) => {
        log.debug('belte:build', `  - ${output.path}`)
    })
    return true
}
