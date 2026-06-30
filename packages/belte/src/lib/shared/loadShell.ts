import { belteLog } from './belteLog.ts'
import { rewriteHashedClientEntries } from './rewriteHashedClientEntries.ts'

/*
Picks `src/browser/app.html` when it exists, otherwise the bundled default
shell. Reads the file once per build so the resolver's two virtual passes share
a single disk hit. Rewrites the literal `/_app/client.js` and `/_app/client.css`
references to the hashed entry filenames emitted by the client build so the
entry bundles can be served with `immutable` cache headers like the chunks.

The default shell ships at src/assets/app.html; this module sits two levels
deeper (src/lib/shared), so the bundled path resolves up two directories.
*/
export async function loadShell(cwd: string): Promise<string> {
    const userShell = `${cwd}/src/browser/app.html`
    const defaultShell = new URL('../../assets/app.html', import.meta.url).pathname
    const filepath = (await Bun.file(userShell).exists()) ? userShell : defaultShell
    if (filepath === userShell) {
        belteLog.info('using custom src/browser/app.html')
    }
    const content = await Bun.file(filepath).text()
    return await rewriteHashedClientEntries(content, cwd)
}
