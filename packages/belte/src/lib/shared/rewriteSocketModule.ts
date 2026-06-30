import { fileStem } from './fileStem.ts'
import { prepareSocketModule } from './prepareSocketModule.ts'
import { socketNameForFile } from './socketNameForFile.ts'

/*
onLoad rewrite for a src/server/sockets/<file>.ts module. The server target
threads the socket name + opts into defineSocket; the client target gets a
name-only socketProxy stub (opts like tail/clientPublish are server-side state
and don't affect client wire behaviour). Returns undefined when the path isn't
under socketsDir so other loaders see the module.
*/
export async function rewriteSocketModule(
    path: string,
    socketsDir: string,
    target: 'server' | 'client',
    importName: string,
): Promise<{ contents: string; loader: 'ts' } | undefined> {
    if (!path.startsWith(`${socketsDir}/`)) {
        return undefined
    }
    const relativePath = path.slice(socketsDir.length + 1)
    const source = await Bun.file(path).text()
    const name = socketNameForFile(relativePath)
    const prepared = prepareSocketModule(source, importName)
    if (!prepared) {
        throw new Error(
            `[belte] src/server/sockets/${relativePath} has no \`export const <name> = socket(...)\` — every $sockets module must declare exactly one socket`,
        )
    }
    const expectedName = fileStem(relativePath)
    if (prepared.exportName !== expectedName) {
        throw new Error(
            `[belte] src/server/sockets/${relativePath} exports \`${prepared.exportName}\` but the filename expects \`${expectedName}\` — the export name must match the file's stem`,
        )
    }
    if (target === 'client') {
        const contents = `import { socketProxy as __belteSocketProxy__ } from '${importName}/browser/socketProxy';
export const ${prepared.exportName} = __belteSocketProxy__(${JSON.stringify(name)});
`
        return { contents, loader: 'ts' }
    }
    const banner = `import { defineSocket as __belteDefineSocket__ } from '${importName}/server/sockets/defineSocket';
`
    return {
        contents: `${banner}${prepared.rewriteForServer(name)}`,
        loader: 'ts',
    }
}
