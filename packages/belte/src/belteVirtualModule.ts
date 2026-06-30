import { existsSync } from 'node:fs'
import { Glob } from 'bun'
import { belteLog } from './lib/shared/belteLog.ts'
import { embedZstdDir } from './lib/shared/embedZstdDir.ts'
import { manifestModule } from './lib/shared/manifestModule.ts'
import { pageUrlForFile } from './lib/shared/pageUrlForFile.ts'
import { programNameForPackage } from './lib/shared/programNameForPackage.ts'
import { promptNameForFile } from './lib/shared/promptNameForFile.ts'
import { rpcUrlForFile } from './lib/shared/rpcUrlForFile.ts'
import { socketNameForFile } from './lib/shared/socketNameForFile.ts'
import type { BelteVirtualContext } from './lib/shared/types/BelteVirtualContext.ts'

/*
Loads every `belte:*` virtual module: the rpc/sockets/prompts/pages/layouts
manifests, the app/config re-exports, the CLI bake-time virtuals, the bundle
launcher virtuals, the zstd asset embeds, and the HTML shell. Closes over the
plugin's per-build context (directories + memoized scanners) so the loaders
share one scan. Returns undefined for an unrecognised path so the caller can
fall through. This file sits beside belteResolverPlugin (src/) so the
disconnected.svelte default resolves against the same `import.meta.url`.
*/
export function belteVirtualModule(
    context: BelteVirtualContext,
): (path: string) => Promise<{ contents: string; loader: 'js' } | undefined> {
    const {
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
    } = context
    return async (path) => {
        if (path === 'belte:rpc') {
            return manifestModule({
                files: await scanRpcOnce(),
                keyForFile: rpcUrlForFile,
                importDir: rpcDir,
                exportName: 'rpc',
            })
        }

        if (path === 'belte:sockets') {
            return manifestModule({
                files: await scanSocketsOnce(),
                keyForFile: socketNameForFile,
                importDir: socketsDir,
                exportName: 'sockets',
            })
        }

        if (path === 'belte:prompts') {
            return manifestModule({
                files: await scanPromptsOnce(),
                keyForFile: promptNameForFile,
                importDir: promptsDir,
                exportName: 'prompts',
                label: 'prompt modules',
            })
        }

        if (path === 'belte:pages') {
            const { pageFiles } = await scanPagesOnce()
            return manifestModule({
                files: pageFiles,
                keyForFile: pageUrlForFile,
                importDir: pagesDir,
                exportName: 'pages',
            })
        }

        if (path === 'belte:layouts') {
            const { layoutFiles } = await scanPagesOnce()
            return manifestModule({
                files: layoutFiles,
                keyForFile: pageUrlForFile,
                importDir: pagesDir,
                exportName: 'layouts',
            })
        }

        if (path === 'belte:errors') {
            const { errorFiles } = await scanPagesOnce()
            return manifestModule({
                files: errorFiles,
                keyForFile: pageUrlForFile,
                importDir: pagesDir,
                exportName: 'errors',
                label: 'error pages',
            })
        }

        if (path === 'belte:app') {
            const userApp = `${cwd}/src/app.ts`
            const hasAppModule = await Bun.file(userApp).exists()
            /* health.d.ts keys the client health() read to the app hook's return type. */
            await writeHealthDtsOnce(hasAppModule)
            if (hasAppModule) {
                belteLog.info('using custom src/app.ts')
                return {
                    contents: `export * from ${JSON.stringify(userApp)}`,
                    loader: 'js',
                }
            }
            return { contents: 'export {};', loader: 'js' }
        }

        if (path === 'belte:config') {
            /*
            Re-exports src/server/config.ts so serverEntry can eager-import
            it at boot — running its `env(schema)` validation once the env
            layers are merged, before the server starts. Optional: an empty
            stub when absent, so an app with no config builds and boots the
            same (it just reads Bun.env directly).
            */
            const userConfig = `${serverDir}/config.ts`
            if (await Bun.file(userConfig).exists()) {
                belteLog.info('using src/server/config.ts')
                return {
                    contents: `export * from ${JSON.stringify(userConfig)}`,
                    loader: 'js',
                }
            }
            return { contents: 'export {};', loader: 'js' }
        }

        if (path === 'belte:cli-manifest') {
            /*
            The CLI binary's bake-time manifest. Discovery (a
            one-shot script the bundler runs separately) writes
            `${cwd}/dist/cli-manifest.json` from the populated
            rpcRegistry; this virtual splices that JSON in as a
            default-exported object. Empty manifest when the
            discovery file is missing — the binary still works
            but exposes no subcommands until the user runs the
            full `belte cli` flow.
            */
            const manifestPath = `${cwd}/dist/cli-manifest.json`
            if (!existsSync(manifestPath)) {
                return { contents: 'export default {}', loader: 'js' }
            }
            const json = await Bun.file(manifestPath).text()
            return { contents: `export default ${json}`, loader: 'js' }
        }

        if (path === 'belte:cli-name') {
            /*
            Program name shown in `<program> --help`. Reads the
            project's package.json `name` field (scoped names keep
            only the final segment), falling back to `app` when
            missing.
            */
            const pkg = await readPackageJsonOnce()
            const name = programNameForPackage(pkg?.name as string | undefined)
            return { contents: `export default ${JSON.stringify(name)}`, loader: 'js' }
        }

        if (path === 'belte:bundle-window') {
            /*
            Optional bundle window config (title/size/menu) baked into
            the bundled launcher. Re-exports the default from
            src/bundle/window.ts when present; otherwise an empty
            object so the launcher falls back to its defaults.
            */
            const userFile = `${cwd}/src/bundle/window.ts`
            if (existsSync(userFile)) {
                belteLog.info('using custom src/bundle/window.ts')
                return {
                    contents: `export { default } from ${JSON.stringify(userFile)}`,
                    loader: 'js',
                }
            }
            return { contents: 'export default {}', loader: 'js' }
        }

        if (path === 'belte:bundle-disconnected') {
            /*
            The connect screen HTML baked into the launcher. buildDisconnected
            writes `${cwd}/dist/bundle-disconnected.html`; this virtual splices
            it in as a string export. A minimal inline fallback keeps the
            launcher buildable when the file is missing (the screen still loads,
            just unstyled) — bundleApp always builds it first.
            */
            const htmlPath = `${cwd}/dist/bundle-disconnected.html`
            if (!existsSync(htmlPath)) {
                const fallback =
                    '<!doctype html><html><body><div id="app">belte</div></body></html>'
                return {
                    contents: `export const disconnectedHtml = ${JSON.stringify(fallback)}`,
                    loader: 'js',
                }
            }
            const html = await Bun.file(htmlPath).text()
            return {
                contents: `export const disconnectedHtml = ${JSON.stringify(html)}`,
                loader: 'js',
            }
        }

        if (path === 'belte:bundle-disconnected-component') {
            /*
            The Svelte component the connect-screen build mounts: the project's
            src/bundle/disconnected.svelte override when present, otherwise the
            lib default. Re-exports the default like belte:bundle-window; the
            svelte loader plugin compiles the .svelte target either way.
            */
            const userFile = `${cwd}/src/bundle/disconnected.svelte`
            if (existsSync(userFile)) {
                belteLog.info('using custom src/bundle/disconnected.svelte')
                return {
                    contents: `export { default } from ${JSON.stringify(userFile)}`,
                    loader: 'js',
                }
            }
            const defaultFile = new URL('./lib/bundle/disconnected.svelte', import.meta.url)
                .pathname
            return {
                contents: `export { default } from ${JSON.stringify(defaultFile)}`,
                loader: 'js',
            }
        }

        if (path === 'belte:cli-chrome') {
            /*
            Optional CLI help chrome baked into the binary: src/cli/
            banner.txt prints atop top-level help, footer.txt prints
            below it. Missing files emit empty strings (no chrome).
            Read as plain text, like belte:shell.
            */
            const readChrome = async (name: string) => {
                const file = Bun.file(`${cliDir}/${name}`)
                return (await file.exists()) ? await file.text() : ''
            }
            const [banner, footer] = await Promise.all([
                readChrome('banner.txt'),
                readChrome('footer.txt'),
            ])
            return {
                contents: `export const banner = ${JSON.stringify(banner)}
export const footer = ${JSON.stringify(footer)}
`,
                loader: 'js',
            }
        }

        if (path === 'belte:app-info') {
            /*
            Project identity ({ name, version }) read from
            package.json, surfaced in the OpenAPI document's `info`
            block. Falls back to placeholder values when the file
            is missing so the spec still emits.
            */
            const pkg = await readPackageJsonOnce()
            const info = {
                name: (pkg?.name as string | undefined) ?? 'app',
                version: (pkg?.version as string | undefined) ?? '0.0.0',
            }
            return {
                contents: `export const appInfo = ${JSON.stringify(info)}`,
                loader: 'js',
            }
        }

        if (path === 'belte:mcp') {
            /*
            The MCP server is fully framework-generated — tools from
            the rpc registry, prompts from src/mcp/prompts, resources
            from src/mcp/resources. createMcpServer is internal; there
            is no user-authored server module. Server identity comes
            from package.json so the `mcp__<name>__*` permission prefix
            is stable and app-specific; absent a name, createMcpServer
            falls back to its own default.
            */
            const importName = await belteImportNameOnce()
            const pkg = await readPackageJsonOnce()
            /* JSON.stringify drops undefined keys, so an absent name/version
               leaves createMcpServer to apply its own defaults. */
            const identity = JSON.stringify({
                name: pkg?.name as string | undefined,
                version: pkg?.version as string | undefined,
            })
            return {
                contents: `import { createMcpServer } from '${importName}/mcp/createMcpServer'\nexport default createMcpServer(${identity})\n`,
                loader: 'js',
            }
        }

        if (path === 'belte:assets') {
            if (!embedAssets) {
                return { contents: 'export const assets = undefined', loader: 'js' }
            }
            const appDir = `${cwd}/dist/_app`
            const files = await Array.fromAsync(
                new Glob('**/*.zst').scan({ cwd: appDir, onlyFiles: true }),
            )
            const contents = await embedZstdDir({
                dir: appDir,
                files,
                keyFor: (file) => `/_app/${file.replace(/\.zst$/, '')}`,
                precompressed: true,
                exportName: 'assets',
                label: 'zstd assets',
                source: 'dist/_app/',
            })
            return { contents, loader: 'js' }
        }

        if (path === 'belte:public-assets') {
            /*
            Embeds every file under public/ (zstd level 22, paid
            once at compile) keyed by its site-root path so the
            standalone binary serves them without a public/ dir on
            disk. Mirrors belte:assets. Empty/undefined when not
            embedding (dev + `belte start` read public/ off disk).
            */
            // Globs public/ and writes publicAssets.d.ts every build; reuse the list to embed.
            const files = await scanPublicOnce()
            if (!embedAssets || files.length === 0) {
                return {
                    contents: 'export const publicAssets = undefined',
                    loader: 'js',
                }
            }
            const contents = await embedZstdDir({
                dir: publicDir,
                files,
                keyFor: (file) => `/${file}`,
                precompressed: false,
                exportName: 'publicAssets',
                label: 'public files',
                source: 'public/',
            })
            return { contents, loader: 'js' }
        }

        if (path === 'belte:mcp-resources') {
            /*
            Embeds every file under src/mcp/resources/ (zstd level
            22) keyed by its path relative to that dir, so the
            standalone binary serves MCP resources without the folder
            on disk. Mirrors belte:public-assets. Undefined when not
            embedding (dev + `belte start` read off disk).
            */
            if (!embedAssets || !existsSync(resourcesDir)) {
                return {
                    contents: 'export const mcpResources = undefined',
                    loader: 'js',
                }
            }
            const files = await Array.fromAsync(
                new Glob('**/*').scan({ cwd: resourcesDir, onlyFiles: true }),
            )
            if (files.length === 0) {
                return {
                    contents: 'export const mcpResources = undefined',
                    loader: 'js',
                }
            }
            const contents = await embedZstdDir({
                dir: resourcesDir,
                files,
                keyFor: (file) => file,
                precompressed: false,
                exportName: 'mcpResources',
                label: 'mcp resources',
                source: 'src/mcp/resources/',
            })
            return { contents, loader: 'js' }
        }

        if (path === 'belte:shell') {
            const content = await loadShellOnce()
            return {
                contents: `export const shell = ${JSON.stringify(content)}`,
                loader: 'js',
            }
        }

        return undefined
    }
}
