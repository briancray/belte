import { existsSync, statSync } from 'node:fs'
import { NO_STORE } from '../../shared/cacheControlValues.ts'
import { log } from '../../shared/log.ts'
import { normalizeTarget } from '../../shared/normalizeTarget.ts'
import { buildEnvContent } from './buildEnvContent.ts'
import { createTarGz } from './createTarGz.ts'
import { maxSourceMtime } from './maxSourceMtime.ts'

/*
Process-wide per-platform build coalescing. Two concurrent curls for
the same /__belte/cli/<platform> share one buildCli invocation; the
later requests await the same promise the first one created. Entries
are cleared on resolution so a subsequent miss re-builds (catches the
case where the user changes an rpc and the on-disk binary is stale).
*/
const pendingBuilds = new Map<string, Promise<string | undefined>>()

async function ensurePlatformBinary(
    platform: string,
    programName: string,
    cwd: string,
): Promise<string | undefined> {
    const binaryPath = `${cwd}/dist/cli-thin/${platform}/${programName}`
    /*
    On-disk binary is fresh when it exists AND its mtime beats the
    newest rpc/socket source mtime. The mtime check catches the
    common dev iteration where the user edits an rpc handler but
    didn't run `belte cli` again. Other source paths (project lib,
    transitive imports) fall back to manual rebuild.
    */
    if (existsSync(binaryPath)) {
        const binaryMtime = statSync(binaryPath).mtimeMs
        const sourceMtime = await maxSourceMtime(cwd)
        if (binaryMtime >= sourceMtime) {
            return binaryPath
        }
        log.info(`thin cli for ${platform} is stale — rebuilding`)
    }
    const existing = pendingBuilds.get(platform)
    if (existing) {
        return existing
    }
    const promise = (async () => {
        try {
            log.info(`lazy-building thin cli for ${platform}…`)
            // Lazy-import buildCli so the build pipeline isn't pulled into
            // production processes that never serve a download.
            const { buildCli } = await import('../../../buildCli.ts')
            await buildCli({
                cwd,
                platforms: [normalizeTarget(platform)],
                thin: true,
            })
            return existsSync(binaryPath) ? binaryPath : undefined
        } catch (error) {
            log.error(error)
            return undefined
        } finally {
            pendingBuilds.delete(platform)
        }
    })()
    pendingBuilds.set(platform, promise)
    return promise
}

/*
Handles GET /__belte/cli/<platform> — streams a gzipped tarball
containing the platform-specific thin binary + a `.env` carrying
APP_URL (and APP_TOKEN if the inbound request was authenticated).

Thin binaries live at `dist/cli-thin/<platform>/<programName>`
(produced by `belte cli` with APP_URL set). Missing platforms produce
404 — the install script reports it, doesn't try to fall back.
*/
export async function handleCliDownload(
    request: Request,
    platform: string,
    programName: string,
    cwd: string,
): Promise<Response> {
    const binaryPath = await ensurePlatformBinary(platform, programName, cwd)
    if (!binaryPath) {
        return new Response(`unknown platform: ${platform}`, {
            status: 404,
            headers: { 'Cache-Control': NO_STORE },
        })
    }
    const url = new URL(request.url)
    const appUrl = `${url.protocol}//${url.host}`
    const auth = request.headers.get('authorization')
    const bearer =
        auth && auth.toLowerCase().startsWith('bearer ') ? auth.slice('bearer '.length) : undefined
    const envContent = buildEnvContent(appUrl, bearer)

    const binaryBytes = await Bun.file(binaryPath).bytes()
    const archive = createTarGz([
        { name: programName, content: binaryBytes, mode: 0o755 },
        { name: '.env', content: new TextEncoder().encode(envContent), mode: 0o644 },
    ])
    return new Response(archive, {
        headers: {
            'Content-Type': 'application/gzip',
            'Content-Disposition': `attachment; filename="${programName}-${platform}.tar.gz"`,
            'Cache-Control': NO_STORE,
        },
    })
}
