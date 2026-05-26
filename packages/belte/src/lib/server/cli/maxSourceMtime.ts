import { existsSync, statSync } from 'node:fs'
import { Glob } from 'bun'

/*
Returns the most-recent mtime across every rpc + socket source file in
the project, or 0 when both directories are absent. The lazy CLI
download path compares this to the binary's mtime to decide whether to
rebuild — covers the common dev iteration of "user edited an rpc
handler" without needing to scan transitively-imported modules.
*/
export async function maxSourceMtime(cwd: string): Promise<number> {
    const roots = [`${cwd}/src/server/rpc`, `${cwd}/src/server/sockets`]
    let newest = 0
    for (const root of roots) {
        if (!existsSync(root)) {
            continue
        }
        const files = new Glob('**/*.ts').scan({ cwd: root, onlyFiles: true })
        for await (const file of files) {
            const stat = statSync(`${root}/${file}`)
            if (stat.mtimeMs > newest) {
                newest = stat.mtimeMs
            }
        }
    }
    return newest
}
