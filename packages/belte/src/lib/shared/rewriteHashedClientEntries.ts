import { existsSync } from 'node:fs'
import { Glob } from 'bun'

/*
Scans `dist/_app/` for the hashed client entry filenames produced by
build.ts (e.g. `client-abc12345.js`, `client-abc12345.css`) and swaps the
shell's literal `/_app/client.js` and `/_app/client.css` references for
them. When the directory is missing (someone running the server before a
build) the shell is returned unchanged so the existing broken-asset
behaviour is preserved.
*/
export async function rewriteHashedClientEntries(shell: string, cwd: string): Promise<string> {
    const appDir = `${cwd}/dist/_app`
    if (!existsSync(appDir)) {
        return shell
    }
    const entries = await Array.fromAsync(
        new Glob('client-*').scan({ cwd: appDir, onlyFiles: true }),
    )
    const jsEntry = entries.find((file) => /^client-[a-z0-9]+\.js$/i.test(file))
    const cssEntry = entries.find((file) => /^client-[a-z0-9]+\.css$/i.test(file))
    let result = shell
    if (jsEntry) {
        result = result.replace('/_app/client.js', `/_app/${jsEntry}`)
    }
    if (cssEntry) {
        result = result.replace('/_app/client.css', `/_app/${cssEntry}`)
    }
    return result
}
