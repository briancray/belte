import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { BunPlugin } from 'bun'
import { belteResolverPlugin } from '../src/belteResolverPlugin.ts'

const roots: string[] = []
afterAll(() => {
    roots.forEach((root) => {
        rmSync(root, { recursive: true, force: true })
    })
})

// Creates a temp project dir, runs `build` to lay out files, returns the dir.
function tempProject(build: (dir: string) => void): string {
    const dir = mkdtempSync(`${tmpdir()}/belte-resolver-`)
    roots.push(dir)
    build(dir)
    return dir
}

/*
Builds a one-file stylesheet through the resolver plugin and returns the
emitted CSS. `extraFiles` lays down any sibling assets a relative url() needs.
Asserts the build succeeded so each test reads as a happy path.
*/
async function buildCss(css: string, extraFiles: Record<string, string> = {}): Promise<string> {
    const cwd = tempProject((root) => {
        mkdirSync(root, { recursive: true })
        writeFileSync(`${root}/app.css`, css)
        writeFileSync(`${root}/entry.ts`, 'import "./app.css"\n')
        for (const [name, contents] of Object.entries(extraFiles)) {
            writeFileSync(`${root}/${name}`, contents)
        }
    })
    const result = await Bun.build({
        entrypoints: [`${cwd}/entry.ts`],
        outdir: `${cwd}/out`,
        target: 'browser',
        plugins: [belteResolverPlugin({ cwd, target: 'client' })],
    })
    expect(result.success).toBe(true)
    return (await result.outputs.find((output) => output.path.endsWith('.css'))?.text()) ?? ''
}

/*
Regression: a root-absolute url() in a stylesheet (a public asset served at
the site root at runtime) must not fail the build. The resolver marks it
external so the literal `/…` path survives into the emitted CSS.
*/
test('leaves root-absolute url() in CSS external instead of resolving it', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(root, { recursive: true })
        writeFileSync(
            `${root}/app.css`,
            '@font-face { font-family: "F"; src: url(/fonts/f.woff2) format("woff2"); }\n' +
                '.bg { background: url(/images/bar.png); }\n',
        )
        writeFileSync(`${root}/entry.ts`, 'import "./app.css"\n')
    })

    const result = await Bun.build({
        entrypoints: [`${cwd}/entry.ts`],
        outdir: `${cwd}/out`,
        target: 'browser',
        plugins: [belteResolverPlugin({ cwd, target: 'client' })],
    })

    expect(result.success).toBe(true)
    const css = await result.outputs.find((output) => output.path.endsWith('.css'))?.text()
    // Literal site-root paths are preserved for the runtime public asset server.
    expect(css).toContain('url("/fonts/f.woff2")')
    expect(css).toContain('url("/images/bar.png")')
})

/*
The external rule is scoped to .css importers so it can't shadow belte's own
absolute-path imports. A relative url() is a genuine build-time asset and must
still resolve and bundle.
*/
test('still resolves relative url() in CSS as a bundled asset', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(root, { recursive: true })
        writeFileSync(`${root}/dot.png`, 'x')
        writeFileSync(`${root}/app.css`, '.bg { background: url(./dot.png); }\n')
        writeFileSync(`${root}/entry.ts`, 'import "./app.css"\n')
    })

    const result = await Bun.build({
        entrypoints: [`${cwd}/entry.ts`],
        outdir: `${cwd}/out`,
        target: 'browser',
        plugins: [belteResolverPlugin({ cwd, target: 'client' })],
    })

    expect(result.success).toBe(true)
    const css = await result.outputs.find((output) => output.path.endsWith('.css'))?.text()
    // Resolved by the bundler — inlined as a data URI (or hashed when large),
    // never left as the original relative specifier.
    expect(css).not.toContain('./dot.png')
    expect(css).toMatch(/url\("(data:|\.?\/?dot-)[^"]+"\)/)
})

// Nested site-root paths survive verbatim — public/ mirrors the URL tree.
test('preserves a deep root-absolute url() path', async () => {
    const css = await buildCss('.bg { background: url(/assets/img/hero.png); }\n')
    expect(css).toContain('url("/assets/img/hero.png")')
})

// Quote style is the author's choice; the path must survive regardless.
test('preserves root-absolute url() written single-quoted or unquoted', async () => {
    const css = await buildCss(
        ".a { background: url('/q/single.png'); }\n.b { background: url(/q/bare.png); }\n",
    )
    expect(css).toContain('url("/q/single.png")')
    expect(css).toContain('url("/q/bare.png")')
})

// A realistic @font-face with several formats — every src entry is site-root.
test('preserves every src in a multi-format @font-face', async () => {
    const css = await buildCss(
        '@font-face {\n' +
            '  font-family: "Inter";\n' +
            '  src: url(/fonts/inter.woff2) format("woff2"),\n' +
            '       url(/fonts/inter.woff) format("woff");\n' +
            '}\n',
    )
    expect(css).toContain('url("/fonts/inter.woff2")')
    expect(css).toContain('url("/fonts/inter.woff")')
})

/*
The common real-world stylesheet: a root-absolute font (runtime public asset)
sitting beside a relative decoration (build-time asset). The font stays
external; the relative one resolves.
*/
test('handles a mix of root-absolute and relative url() in one sheet', async () => {
    const css = await buildCss(
        '@font-face { font-family: "F"; src: url(/fonts/f.woff2); }\n' +
            '.icon { background: url(./icon.png); }\n',
        { 'icon.png': 'x' },
    )
    expect(css).toContain('url("/fonts/f.woff2")')
    expect(css).not.toContain('./icon.png')
    expect(css).toMatch(/url\("(data:|\.?\/?icon-)[^"]+"\)/)
})

// External absolute URLs are already left alone by Bun; the rule mustn't disturb them.
test('leaves absolute http(s) and data url() untouched', async () => {
    const css = await buildCss(
        '.a { background: url(https://cdn.example.com/x.png); }\n' +
            '.b { background: url(data:image/gif;base64,R0lGOD); }\n',
    )
    expect(css).toContain('url("https://cdn.example.com/x.png")')
    expect(css).toContain('url("data:image/gif;base64,R0lGOD")')
})

// The plugin is constructed per target; the server build must externalize too.
test('externalizes root-absolute url() for the server target', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(root, { recursive: true })
        writeFileSync(`${root}/app.css`, '.bg { background: url(/images/server.png); }\n')
        writeFileSync(`${root}/entry.ts`, 'import "./app.css"\n')
    })
    const result = await Bun.build({
        entrypoints: [`${cwd}/entry.ts`],
        outdir: `${cwd}/out`,
        target: 'browser',
        plugins: [belteResolverPlugin({ cwd, target: 'server' })],
    })
    expect(result.success).toBe(true)
    const css = await result.outputs.find((output) => output.path.endsWith('.css'))?.text()
    expect(css).toContain('url("/images/server.png")')
})

/* Stub loader so the manifest's dynamic `import("…/error.svelte")` bundles
without pulling in the real Svelte compiler. */
const svelteStub: BunPlugin = {
    name: 'svelte-stub',
    setup(build) {
        build.onLoad({ filter: /\.svelte$/ }, () => ({
            contents: 'export default {}',
            loader: 'js',
        }))
    },
}

/*
Marks belte package imports (canonical or aliased) external so the import
banners the plugin generates resolve without an installed belte. The emitted
import statements survive into the bundle text, where tests assert on them.
*/
const belteExternal: BunPlugin = {
    name: 'belte-external',
    setup(build) {
        build.onResolve({ filter: /^(belte|@belte\/belte)\// }, (args) => ({
            path: args.path,
            external: true,
        }))
    },
}

/*
Stub loader that replaces every .svelte module with its own path as the
default export, so manifest and re-export tests can assert which file was
wired without compiling Svelte.
*/
const sveltePathStub: BunPlugin = {
    name: 'svelte-path-stub',
    setup(build) {
        build.onLoad({ filter: /\.svelte$/ }, (args) => ({
            contents: `export default ${JSON.stringify(args.path)}`,
            loader: 'js',
        }))
    },
}

/*
Builds `entry.ts` in a temp project through the resolver plugin and returns
the bundle text plus build diagnostics. Belte imports are externalized and
.svelte files stubbed so the plugin's codegen is what's under test.
*/
async function buildProject(options: {
    cwd: string
    target?: 'server' | 'client'
    embedAssets?: boolean
}): Promise<{ success: boolean; bundle: string; messages: string[] }> {
    const result = await Bun.build({
        entrypoints: [`${options.cwd}/entry.ts`],
        outdir: `${options.cwd}/out`,
        target: 'bun',
        throw: false,
        plugins: [
            belteResolverPlugin({
                cwd: options.cwd,
                target: options.target ?? 'server',
                embedAssets: options.embedAssets ?? false,
            }),
            belteExternal,
            sveltePathStub,
        ],
    })
    return {
        success: result.success,
        bundle: result.success ? ((await result.outputs[0]?.text()) ?? '') : '',
        messages: result.logs.map((buildLog) => buildLog.message),
    }
}

// Lays down a valid rpc handler whose body carries a server-only marker.
function rpcProject(): string {
    return tempProject((root) => {
        mkdirSync(`${root}/src/server/rpc`, { recursive: true })
        writeFileSync(
            `${root}/src/server/rpc/getThing.ts`,
            "import { GET } from '@belte/belte/server/GET'\n" +
                "export const getThing = GET(async () => ({ secret: 'SERVER_ONLY_BODY' }))\n",
        )
        writeFileSync(`${root}/entry.ts`, "export { getThing } from '$server/rpc/getThing'\n")
    })
}

/*
$-aliases map to the five project dirs and sub-paths resolve Node-style:
an exact file with extension appended, or a directory's index file.
*/
test('resolves $shared sub-paths through extension and index resolution', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(`${root}/src/shared/util`, { recursive: true })
        writeFileSync(`${root}/src/shared/util/index.ts`, "export const fromIndex = 'FROM_INDEX'\n")
        writeFileSync(`${root}/src/shared/answer.ts`, "export const answer = 'FROM_FILE'\n")
        writeFileSync(
            `${root}/entry.ts`,
            "export { fromIndex } from '$shared/util'\nexport { answer } from '$shared/answer'\n",
        )
    })
    const { success, bundle } = await buildProject({ cwd })
    expect(success).toBe(true)
    expect(bundle).toContain('FROM_INDEX')
    expect(bundle).toContain('FROM_FILE')
})

/*
Server target: the rpc import is stripped and the `GET(` call rewritten to
defineRpc with the rpc + the URL derived from the file path, keeping the
user's handler body.
*/
test('rewrites an rpc module to defineRpc for the server target', async () => {
    const { success, bundle } = await buildProject({ cwd: rpcProject(), target: 'server' })
    expect(success).toBe(true)
    expect(bundle).toContain('@belte/belte/server/rpc/defineRpc')
    expect(bundle).toContain('"GET"')
    expect(bundle).toContain('"/rpc/getThing"')
    expect(bundle).toContain('SERVER_ONLY_BODY')
})

/*
Client target: the whole module is replaced by a remoteProxy stub under the
same export name — the handler body must never reach the browser bundle.
*/
test('replaces an rpc module with a remoteProxy stub for the client target', async () => {
    const { success, bundle } = await buildProject({ cwd: rpcProject(), target: 'client' })
    expect(success).toBe(true)
    expect(bundle).toContain('@belte/belte/browser/remoteProxy')
    expect(bundle).toContain('"/rpc/getThing"')
    expect(bundle).not.toContain('SERVER_ONLY_BODY')
})

test('fails the build when an rpc module declares no rpc export', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(`${root}/src/server/rpc`, { recursive: true })
        writeFileSync(`${root}/src/server/rpc/getThing.ts`, 'export const getThing = 1\n')
        writeFileSync(`${root}/entry.ts`, "export { getThing } from '$server/rpc/getThing'\n")
    })
    const { success, messages } = await buildProject({ cwd })
    expect(success).toBe(false)
    expect(messages.join('\n')).toContain('has no `export const <name> = <METHOD>(...)`')
})

test('fails the build when the rpc export name does not match the file stem', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(`${root}/src/server/rpc`, { recursive: true })
        writeFileSync(
            `${root}/src/server/rpc/getThing.ts`,
            "import { GET } from '@belte/belte/server/GET'\n" +
                'export const wrongName = GET(async () => 1)\n',
        )
        writeFileSync(`${root}/entry.ts`, "export { wrongName } from '$server/rpc/getThing'\n")
    })
    const { success, messages } = await buildProject({ cwd })
    expect(success).toBe(false)
    expect(messages.join('\n')).toContain("the export name must match the file's stem")
})

// Lays down a socket module with server-side opts behind a marker.
function socketProject(): string {
    return tempProject((root) => {
        mkdirSync(`${root}/src/server/sockets`, { recursive: true })
        writeFileSync(
            `${root}/src/server/sockets/chat.ts`,
            "import { socket } from '@belte/belte/server/socket'\n" +
                "export const chat = socket({ tail: 'SERVER_ONLY_OPTS' })\n",
        )
        writeFileSync(`${root}/entry.ts`, "export { chat } from '$server/sockets/chat'\n")
    })
}

// Server target threads the file-derived socket name and keeps the user's opts.
test('rewrites a socket module to defineSocket for the server target', async () => {
    const { success, bundle } = await buildProject({ cwd: socketProject(), target: 'server' })
    expect(success).toBe(true)
    expect(bundle).toContain('@belte/belte/server/sockets/defineSocket')
    expect(bundle).toContain('"chat"')
    expect(bundle).toContain('SERVER_ONLY_OPTS')
})

// Client target gets a name-only proxy — opts are server-side state.
test('replaces a socket module with a socketProxy stub for the client target', async () => {
    const { success, bundle } = await buildProject({ cwd: socketProject(), target: 'client' })
    expect(success).toBe(true)
    expect(bundle).toContain('@belte/belte/browser/socketProxy')
    expect(bundle).toContain('"chat"')
    expect(bundle).not.toContain('SERVER_ONLY_OPTS')
})

// Lays down a markdown prompt with frontmatter metadata and a template body.
function promptProject(): string {
    return tempProject((root) => {
        mkdirSync(`${root}/src/mcp/prompts`, { recursive: true })
        writeFileSync(
            `${root}/src/mcp/prompts/greet.md`,
            '---\ndescription: Greets someone\narguments:\n  - name: who\n    required: true\n---\nHello {{who}}!\n',
        )
        writeFileSync(`${root}/entry.ts`, "export { prompt } from '$mcp/prompts/greet.md'\n")
    })
}

/*
A .md prompt compiles to a definePrompt registration: name from the file path,
description + argument schema from the frontmatter, body embedded as the
render template.
*/
test('compiles a markdown prompt to a definePrompt module on the server', async () => {
    const { success, bundle } = await buildProject({ cwd: promptProject(), target: 'server' })
    expect(success).toBe(true)
    expect(bundle).toContain('@belte/belte/server/prompts/definePrompt')
    expect(bundle).toContain('"greet"')
    expect(bundle).toContain('Greets someone')
    expect(bundle).toContain('Hello {{who}}!')
})

// Prompts are MCP-only; the client target gets an empty stub.
test('emits an empty stub for a prompt module on the client target', async () => {
    const { success, bundle } = await buildProject({ cwd: promptProject(), target: 'client' })
    expect(success).toBe(true)
    expect(bundle).not.toContain('Hello {{who}}')
})

// The rpc and socket manifests key each lazy import by URL / socket name.
test('builds the belte:rpc and belte:sockets manifests', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(`${root}/src/server/rpc`, { recursive: true })
        mkdirSync(`${root}/src/server/sockets/orders`, { recursive: true })
        writeFileSync(
            `${root}/src/server/rpc/getThing.ts`,
            "import { GET } from '@belte/belte/server/GET'\n" +
                'export const getThing = GET(async () => 1)\n',
        )
        writeFileSync(
            `${root}/src/server/sockets/orders/news.ts`,
            "import { socket } from '@belte/belte/server/socket'\n" +
                'export const news = socket()\n',
        )
        writeFileSync(
            `${root}/entry.ts`,
            "export { rpc } from './_virtual/rpc.ts'\nexport { sockets } from './_virtual/sockets.ts'\n",
        )
    })
    const { success, bundle } = await buildProject({ cwd })
    expect(success).toBe(true)
    expect(bundle).toContain('"/rpc/getThing"')
    // Nested socket files keep their path as the wire name.
    expect(bundle).toContain('"orders/news"')
})

// pages and layouts manifests partition the same scan, keyed by directory prefix.
test('builds belte:pages and belte:layouts manifests keyed by directory prefix', async () => {
    const cwd = tempProject((root) => {
        const pages = `${root}/src/browser/pages`
        mkdirSync(`${pages}/admin`, { recursive: true })
        writeFileSync(`${pages}/page.svelte`, '<h1>home</h1>')
        writeFileSync(`${pages}/layout.svelte`, '<slot />')
        writeFileSync(`${pages}/admin/page.svelte`, '<h1>admin</h1>')
        writeFileSync(
            `${root}/entry.ts`,
            "export { pages } from './_virtual/pages.ts'\nexport { layouts } from './_virtual/layouts.ts'\n",
        )
    })
    const { success, bundle } = await buildProject({ cwd })
    expect(success).toBe(true)
    expect(bundle).toContain('"/admin"')
    expect(bundle).toMatch(/"\/":\s*\(\)\s*=>/)
    expect(bundle).toContain('layout.svelte')
})

// A .svelte file outside the page/layout/error naming contract fails loudly.
test('fails the build on a misnamed file under src/browser/pages', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(`${root}/src/browser/pages`, { recursive: true })
        writeFileSync(`${root}/src/browser/pages/about.svelte`, '<h1>about</h1>')
        writeFileSync(`${root}/entry.ts`, "export { pages } from './_virtual/pages.ts'\n")
    })
    const { success, messages } = await buildProject({ cwd })
    expect(success).toBe(false)
    expect(messages.join('\n')).toContain('is not a recognized page file')
})

// belte:app and belte:config re-export the user module when present.
test('belte:app and belte:config splice the user modules when present', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(`${root}/src/server`, { recursive: true })
        writeFileSync(`${root}/src/app.ts`, "export const handle = 'USER_APP_HOOK'\n")
        writeFileSync(`${root}/src/server/config.ts`, "export const config = 'USER_CONFIG'\n")
        writeFileSync(
            `${root}/entry.ts`,
            "export * from './_virtual/app.ts'\nexport * from './_virtual/config.ts'\n",
        )
    })
    const { success, bundle } = await buildProject({ cwd })
    expect(success).toBe(true)
    expect(bundle).toContain('USER_APP_HOOK')
    expect(bundle).toContain('USER_CONFIG')
})

// Without user modules both virtuals are empty stubs and the build still succeeds.
test('belte:app and belte:config fall back to empty stubs when absent', async () => {
    const cwd = tempProject((root) => {
        writeFileSync(
            `${root}/entry.ts`,
            "export * from './_virtual/app.ts'\nexport * from './_virtual/config.ts'\n",
        )
    })
    const { success } = await buildProject({ cwd })
    expect(success).toBe(true)
})

// Without src/browser/app.html the bundled default shell is embedded.
test('belte:shell embeds the default shell when the project has none', async () => {
    const cwd = tempProject((root) => {
        writeFileSync(`${root}/entry.ts`, "export { shell } from './_virtual/shell.ts'\n")
    })
    const { success, bundle } = await buildProject({ cwd })
    expect(success).toBe(true)
    expect(bundle).toContain('<!--ssr:body-->')
})

/*
A custom shell is preferred, and its literal /_app/client.js + .css references
are rewritten to the hashed entry filenames found in dist/_app so the entries
can be served immutable.
*/
test('belte:shell uses the custom shell and rewrites hashed client entries', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(`${root}/src/browser`, { recursive: true })
        mkdirSync(`${root}/dist/_app`, { recursive: true })
        writeFileSync(
            `${root}/src/browser/app.html`,
            '<html><head>CUSTOM_SHELL<link href="/_app/client.css" /></head>' +
                '<body><script src="/_app/client.js"></script></body></html>',
        )
        writeFileSync(`${root}/dist/_app/client-abc12345.js`, '')
        writeFileSync(`${root}/dist/_app/client-abc12345.css`, '')
        writeFileSync(`${root}/entry.ts`, "export { shell } from './_virtual/shell.ts'\n")
    })
    const { success, bundle } = await buildProject({ cwd })
    expect(success).toBe(true)
    expect(bundle).toContain('CUSTOM_SHELL')
    expect(bundle).toContain('/_app/client-abc12345.js')
    expect(bundle).toContain('/_app/client-abc12345.css')
})

// cli-name keeps the final segment of a scoped name; app-info carries name + version.
test('belte:cli-name and belte:app-info read project identity from package.json', async () => {
    const cwd = tempProject((root) => {
        writeFileSync(
            `${root}/package.json`,
            JSON.stringify({ name: '@acme/demo-tool', version: '1.2.3' }),
        )
        writeFileSync(
            `${root}/entry.ts`,
            "export { default as cliName } from './_virtual/cli-name.ts'\n" +
                "export { appInfo } from './_virtual/app-info.ts'\n",
        )
    })
    const { success, bundle } = await buildProject({ cwd })
    expect(success).toBe(true)
    expect(bundle).toContain('"demo-tool"')
    expect(bundle).toContain('"@acme/demo-tool"')
    expect(bundle).toContain('"1.2.3"')
})

// cli-manifest splices dist/cli-manifest.json verbatim; cli-chrome reads banner/footer text.
test('belte:cli-manifest and belte:cli-chrome splice discovery output and chrome files', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(`${root}/dist`, { recursive: true })
        mkdirSync(`${root}/src/cli`, { recursive: true })
        writeFileSync(`${root}/dist/cli-manifest.json`, '{"getThing":{"method":"GET"}}')
        writeFileSync(`${root}/src/cli/banner.txt`, 'BANNER_TEXT')
        writeFileSync(`${root}/src/cli/footer.txt`, 'FOOTER_TEXT')
        writeFileSync(
            `${root}/entry.ts`,
            "export { default as manifest } from './_virtual/cli-manifest.ts'\n" +
                "export { banner, footer } from './_virtual/cli-chrome.ts'\n",
        )
    })
    const { success, bundle } = await buildProject({ cwd })
    expect(success).toBe(true)
    // The bundler may unquote the manifest's object keys; match the key bare.
    expect(bundle).toMatch(/getThing.*method/s)
    expect(bundle).toContain('BANNER_TEXT')
    expect(bundle).toContain('FOOTER_TEXT')
})

// Missing discovery and chrome files degrade to an empty manifest and empty strings.
test('belte:cli-manifest and belte:cli-chrome degrade when their files are missing', async () => {
    const cwd = tempProject((root) => {
        writeFileSync(
            `${root}/entry.ts`,
            "export { default as manifest } from './_virtual/cli-manifest.ts'\n" +
                "export { banner, footer } from './_virtual/cli-chrome.ts'\n",
        )
    })
    const { success } = await buildProject({ cwd })
    expect(success).toBe(true)
})

// Bundle virtuals splice the project's overrides when present.
test('bundle virtuals splice project window, disconnected html, and component overrides', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(`${root}/src/bundle`, { recursive: true })
        mkdirSync(`${root}/dist`, { recursive: true })
        writeFileSync(`${root}/src/bundle/window.ts`, "export default { title: 'WINDOW_TITLE' }\n")
        writeFileSync(`${root}/dist/bundle-disconnected.html`, '<html>DISCONNECTED_HTML</html>')
        writeFileSync(`${root}/src/bundle/disconnected.svelte`, '<h1>custom</h1>')
        writeFileSync(
            `${root}/entry.ts`,
            "export { default as windowConfig } from './_virtual/bundle-window.ts'\n" +
                "export { disconnectedHtml } from './_virtual/bundle-disconnected.ts'\n" +
                "export { default as component } from './_virtual/bundle-disconnected-component.ts'\n",
        )
    })
    const { success, bundle } = await buildProject({ cwd })
    expect(success).toBe(true)
    expect(bundle).toContain('WINDOW_TITLE')
    expect(bundle).toContain('DISCONNECTED_HTML')
    // sveltePathStub exports the compiled file's path — proves the override won.
    expect(bundle).toContain('src/bundle/disconnected.svelte')
})

// Without overrides the bundle virtuals fall back to defaults and the lib component.
test('bundle virtuals fall back to defaults when the project has no overrides', async () => {
    const cwd = tempProject((root) => {
        writeFileSync(
            `${root}/entry.ts`,
            "export { default as windowConfig } from './_virtual/bundle-window.ts'\n" +
                "export { disconnectedHtml } from './_virtual/bundle-disconnected.ts'\n" +
                "export { default as component } from './_virtual/bundle-disconnected-component.ts'\n",
        )
    })
    const { success, bundle } = await buildProject({ cwd })
    expect(success).toBe(true)
    expect(bundle).toContain('<!doctype html>')
    expect(bundle).toContain('lib/bundle/disconnected.svelte')
})

// Asset virtuals are undefined stubs when embedding is off (dev + `belte start`).
test('asset virtuals export undefined when embedAssets is off', async () => {
    const cwd = tempProject((root) => {
        writeFileSync(
            `${root}/entry.ts`,
            "export { assets } from './_virtual/assets.ts'\n" +
                "export { publicAssets } from './_virtual/public-assets.ts'\n" +
                "export { mcpResources } from './_virtual/mcp-resources.ts'\n",
        )
    })
    const { success, bundle } = await buildProject({ cwd })
    expect(success).toBe(true)
    expect(bundle).toContain('assets = undefined')
    expect(bundle).toContain('publicAssets = undefined')
    expect(bundle).toContain('mcpResources = undefined')
})

/*
embedAssets bakes all three trees into base64 zstd maps: dist/_app chunks
(pre-compressed .zst, key under /_app/ minus the suffix), public/ files
(compressed here, keyed at the site root), and mcp resources (keyed relative).
*/
test('embedAssets embeds chunk, public, and mcp-resource files as zstd maps', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(`${root}/dist/_app`, { recursive: true })
        mkdirSync(`${root}/src/browser/public`, { recursive: true })
        mkdirSync(`${root}/src/mcp/resources`, { recursive: true })
        writeFileSync(`${root}/dist/_app/chunk.js.zst`, 'precompressed-bytes')
        writeFileSync(`${root}/src/browser/public/hello.txt`, 'hello world')
        writeFileSync(`${root}/src/mcp/resources/doc.txt`, 'resource body')
        writeFileSync(
            `${root}/entry.ts`,
            "export { assets } from './_virtual/assets.ts'\n" +
                "export { publicAssets } from './_virtual/public-assets.ts'\n" +
                "export { mcpResources } from './_virtual/mcp-resources.ts'\n",
        )
    })
    const { success, bundle } = await buildProject({ cwd, embedAssets: true })
    expect(success).toBe(true)
    expect(bundle).toContain('"/_app/chunk.js"')
    expect(bundle).toContain('"/hello.txt"')
    expect(bundle).toContain('"doc.txt"')
    expect(bundle).toContain('fromBase64')
})

// belte:mcp generates the framework-owned server module — no user file involved.
test('belte:mcp emits the framework createMcpServer module', async () => {
    const cwd = tempProject((root) => {
        writeFileSync(`${root}/entry.ts`, "export { default as mcp } from './_virtual/mcp.ts'\n")
    })
    const { success, bundle } = await buildProject({ cwd })
    expect(success).toBe(true)
    expect(bundle).toContain('@belte/belte/mcp/createMcpServer')
})

/*
error.svelte files partition into the belte:errors manifest keyed by their
directory prefix (pageUrlForFile), exactly like layouts — the root one keys to
"/" and a nested one to its folder. scanPages must accept error.svelte as a
recognized leaf rather than throwing the "unrecognized page file" error.
*/
test('builds a belte:errors manifest keyed by directory prefix', async () => {
    const cwd = tempProject((root) => {
        const pages = `${root}/src/browser/pages`
        mkdirSync(`${pages}/admin`, { recursive: true })
        writeFileSync(`${pages}/page.svelte`, '<h1>home</h1>')
        writeFileSync(`${pages}/error.svelte`, '<h1>error</h1>')
        writeFileSync(`${pages}/admin/error.svelte`, '<h1>admin error</h1>')
        writeFileSync(`${root}/entry.ts`, 'export { errors } from "./_virtual/errors.ts"\n')
    })

    const result = await Bun.build({
        entrypoints: [`${cwd}/entry.ts`],
        outdir: `${cwd}/out`,
        target: 'bun',
        plugins: [belteResolverPlugin({ cwd, target: 'server' }), svelteStub],
    })

    expect(result.success).toBe(true)
    const bundle = (await result.outputs[0]?.text()) ?? ''
    // Both prefixes present, each a lazy loader for its error.svelte.
    expect(bundle).toContain('"/admin"')
    expect(bundle).toMatch(/"\/":\s*\(\)\s*=>/)
    expect(bundle).toContain('error.svelte')
})
