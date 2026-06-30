// node:fs existsSync — Bun plugin onResolve is sync-only; Bun.file().exists() is async
import { existsSync } from 'node:fs'
import type { BunPlugin } from 'bun'
import { Glob } from 'bun'
import { belteVirtualModule } from './belteVirtualModule.ts'
import { belteImportName } from './lib/shared/belteImportName.ts'
import { escapeRegex } from './lib/shared/escapeRegex.ts'
import { fileStem } from './lib/shared/fileStem.ts'
import { loadShell } from './lib/shared/loadShell.ts'
import { once } from './lib/shared/once.ts'
import { readPackageJson } from './lib/shared/readPackageJson.ts'
import { resolveExtension } from './lib/shared/resolveExtension.ts'
import { rewritePromptModule } from './lib/shared/rewritePromptModule.ts'
import { rewriteRpcModule } from './lib/shared/rewriteRpcModule.ts'
import { rewriteSocketModule } from './lib/shared/rewriteSocketModule.ts'
import { scanDir } from './lib/shared/scanDir.ts'
import { scanPages } from './lib/shared/scanPages.ts'
import { writeHealthDts } from './lib/shared/writeHealthDts.ts'
import { writePublicAssetsDts } from './lib/shared/writePublicAssetsDts.ts'
import { writeRoutesDts } from './lib/shared/writeRoutesDts.ts'
import { writeRpcDts } from './lib/shared/writeRpcDts.ts'
import { writeTestRpcDts } from './lib/shared/writeTestRpcDts.ts'
import { writeTestSocketsDts } from './lib/shared/writeTestSocketsDts.ts'

const NS = 'belte-virtual'

/*
Bun plugin that wires every virtual import belte produces at build time:
- `belte:rpc`     — { rpcUrl: () => import(rpc-module) } HTTP-method manifest
- `belte:sockets` — { socketName: () => import(socket-module) } socket manifest
- `belte:pages`   — { pageUrl: () => import(page.svelte) } manifest
- `belte:layouts` — { dirPrefix: () => import(layout.svelte) } manifest
- `belte:prompts` — { promptName: () => import(prompt-module) } manifest
- `belte:app`     — { init?, handle?, handleError? } from src/app.ts
- `belte:assets`  — zstd-compressed chunk bytes embedded for standalone compile
- `belte:public-assets`  — zstd-embedded src/browser/public files
- `belte:mcp-resources`  — zstd-embedded src/mcp/resources files
- `belte:shell`   — app.html content (custom or default)

Also rewrites modules under src/server/rpc and src/server/sockets:
- src/server/rpc/<file>.ts: each HTTP-method export is bound to a runtime
  implementation — defineRpc on the server, remoteProxy on the client.
- src/server/sockets/<file>.ts: each `socket(opts)` export is bound to
  defineSocket on the server (with the socket name + opts) or
  socketProxy on the client (name only — opts are server-side).
*/
// @readme plumbing
export function belteResolverPlugin({
    cwd = process.cwd(),
    embedAssets = false,
    target = 'server',
}: {
    cwd?: string
    embedAssets?: boolean
    target?: 'server' | 'client'
} = {}): BunPlugin {
    const serverDir = `${cwd}/src/server`
    const browserDir = `${cwd}/src/browser`
    const sharedDir = `${cwd}/src/shared`
    const mcpDir = `${cwd}/src/mcp`
    const cliDir = `${cwd}/src/cli`
    const rpcDir = `${serverDir}/rpc`
    const socketsDir = `${serverDir}/sockets`
    const pagesDir = `${browserDir}/pages`
    const publicDir = `${browserDir}/public`
    const promptsDir = `${mcpDir}/prompts`
    const resourcesDir = `${mcpDir}/resources`

    /*
    The bare specifier the project imports belte under (canonical
    `@belte/belte` or a package alias). Resolved once from the project's
    package.json and threaded into every generated module so the codegen's
    imports resolve regardless of which install style the project uses.
    */
    const belteImportNameOnce = once(() => belteImportName(cwd))
    /*
    The whole-tree validation + per-leaf classification only needs to run
    once per build. Memoise the promise so the virtual manifests
    (rpc/sockets/pages/layouts) share a single scan instead of each one
    re-globbing the trees. The shell read is memoised the same way so two
    passes don't re-read app.html from disk.
    */
    const scanPagesOnce = once(() =>
        scanPages(pagesDir).then(async (scan) => {
            await writeRoutesDts({
                cwd,
                pageFiles: scan.pageFiles,
                importName: await belteImportNameOnce(),
            })
            return scan
        }),
    )
    const scanRpcOnce = once(() =>
        scanDir(rpcDir, '**/*.ts').then(async (rpcFiles) => {
            const importName = await belteImportNameOnce()
            await writeRpcDts({ cwd, rpcDir, rpcFiles, importName })
            /* Typed createTestApp `app.rpc.<rpc>` surface. */
            await writeTestRpcDts({ cwd, rpcFiles, importName })
            return rpcFiles
        }),
    )
    const scanSocketsOnce = once(() =>
        scanDir(socketsDir, '**/*.ts').then(async (socketFiles) => {
            /* Typed createTestApp `app.sockets.<name>` surface. */
            await writeTestSocketsDts({
                cwd,
                socketFiles,
                importName: await belteImportNameOnce(),
            })
            return socketFiles
        }),
    )
    /* One write per build, from the belte:app loader (the seam that already knows whether src/app.ts exists). */
    let healthDtsWritten: Promise<void> | undefined
    const writeHealthDtsOnce = (hasAppModule: boolean): Promise<void> => {
        healthDtsWritten ??= belteImportNameOnce().then((importName) =>
            writeHealthDts({ cwd, hasAppModule, importName }),
        )
        return healthDtsWritten
    }
    /*
    Globs public/ once per build and writes publicAssets.d.ts so url() can
    autocomplete known assets — independent of embedding (runs in dev/start
    too, where the files are read off disk). The public-assets virtual reuses
    the returned list for its embed.
    */
    const scanPublicOnce = once(async () => {
        const publicFiles = existsSync(publicDir)
            ? await Array.fromAsync(new Glob('**/*').scan({ cwd: publicDir, onlyFiles: true }))
            : []
        await writePublicAssetsDts({ cwd, publicFiles, importName: await belteImportNameOnce() })
        return publicFiles
    })
    const scanPromptsOnce = once(() => scanDir(promptsDir, '**/*.md'))
    const loadShellOnce = once(() => loadShell(cwd))
    /* Project package.json read once per build — three virtuals (cli-name,
       app-info, mcp identity) derive fields from it. */
    const readPackageJsonOnce = once(() => readPackageJson(cwd))

    const rpcFilter = new RegExp(`^${escapeRegex(rpcDir)}/.*\\.ts$`)
    const socketsFilter = new RegExp(`^${escapeRegex(socketsDir)}/.*\\.ts$`)
    const promptsFilter = new RegExp(`^${escapeRegex(promptsDir)}/.*\\.md$`)

    return {
        name: 'belte-resolver',
        setup(build) {
            build.onResolve(
                {
                    filter: /\/_virtual\/(rpc|sockets|prompts|pages|layouts|errors|app|config|mcp-resources|mcp|assets|public-assets|shell|app-info|cli-manifest|cli-name|cli-chrome|bundle-window|bundle-disconnected-component|bundle-disconnected)\.ts$/,
                },
                (args) => {
                    const name = fileStem(args.path)
                    if (!name) {
                        return undefined
                    }
                    return { path: `belte:${name}`, namespace: NS }
                },
            )

            /*
            User-facing aliases are the five top-level project directories.
            Sub-paths fall out of them: `$server/rpc/getThing`,
            `$browser/pages/...`, `$mcp/prompts/...`, `$mcp/resources/...`.
            `lib/` is userland — projects declare their own lib aliases.
            */
            const dirAliases: Record<string, string> = {
                $server: serverDir,
                $browser: browserDir,
                $shared: sharedDir,
                $mcp: mcpDir,
                $cli: cliDir,
            }
            for (const [alias, baseDir] of Object.entries(dirAliases)) {
                build.onResolve({ filter: new RegExp(`^\\${alias}(\\/.*)?$`) }, (args) => {
                    const subpath = args.path.slice(alias.length)
                    return { path: resolveExtension(subpath ? `${baseDir}${subpath}` : baseDir) }
                })
            }

            /*
            Root-absolute url() references in stylesheets (e.g.
            `url(/fonts/x.woff2)`) point at files served from public/ at the
            site root at runtime, not at anything on disk at build time. Bun's
            CSS bundler otherwise tries to resolve them against the project
            root and fails the whole build. Mark them external so the literal
            `/…` path survives into the emitted CSS, where
            createPublicAssetServer serves it. Scoped to CSS importers: svelte
            <style> blocks compile to injected JS strings and never reach the
            CSS bundler, and belte's own absolute-path JS imports come from
            .ts/virtual importers — neither is a `.css` importer, so both are
            untouched. Relative url()s (`./x.png`) still resolve and bundle
            normally.
            */
            build.onResolve({ filter: /^\// }, (args) => {
                if (args.importer.endsWith('.css')) {
                    return { path: args.path, external: true }
                }
                return undefined
            })

            build.onLoad({ filter: rpcFilter }, async (args) =>
                rewriteRpcModule(args.path, rpcDir, target, await belteImportNameOnce()),
            )

            build.onLoad({ filter: socketsFilter }, async (args) =>
                rewriteSocketModule(args.path, socketsDir, target, await belteImportNameOnce()),
            )

            build.onLoad({ filter: promptsFilter }, async (args) =>
                rewritePromptModule(args.path, promptsDir, target, await belteImportNameOnce()),
            )

            const loadVirtual = belteVirtualModule({
                cwd,
                serverDir,
                cliDir,
                pagesDir,
                publicDir,
                resourcesDir,
                rpcDir,
                socketsDir,
                promptsDir,
                embedAssets,
                scanRpcOnce,
                scanSocketsOnce,
                scanPromptsOnce,
                scanPagesOnce,
                scanPublicOnce,
                loadShellOnce,
                readPackageJsonOnce,
                belteImportNameOnce,
                writeHealthDtsOnce,
            })
            build.onLoad({ filter: /.*/, namespace: NS }, (args) => loadVirtual(args.path))
        },
    }
}
