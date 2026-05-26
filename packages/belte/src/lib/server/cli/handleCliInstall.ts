import { NO_STORE } from '../../shared/cacheControlValues.ts'
import { installScript } from './installScript.ts'

/*
Handles GET /__belte/cli — returns the platform-detecting shell script.
Authoritative URL for the tarball is derived from the inbound request
(so the script's curl line points at whatever host the user reached us
on). Program name is the bundler-emitted `belte:cli-name` value.
*/
export function handleCliInstall(request: Request, programName: string): Response {
    const url = new URL(request.url)
    const appUrl = `${url.protocol}//${url.host}`
    const script = installScript(appUrl, programName)
    return new Response(script, {
        headers: {
            'Content-Type': 'text/x-shellscript; charset=utf-8',
            'Cache-Control': NO_STORE,
        },
    })
}
