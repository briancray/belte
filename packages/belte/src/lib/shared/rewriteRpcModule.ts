import { fileStem } from './fileStem.ts'
import { prepareRpcModule } from './prepareRpcModule.ts'
import { rpcUrlForFile } from './rpcUrlForFile.ts'

/*
onLoad rewrite for a src/server/rpc/<file>.ts module. The server target strips
the user's method import and threads the method (from the export identifier)
and the URL (from the file path) into defineRpc, keeping the handler body
intact. The client target replaces the whole module with a remoteProxy stub so
the handler and its server-only imports never reach the browser, keyed by the
same export name so page imports resolve identically on both sides. Returns
undefined when the path isn't under rpcDir so other loaders see the module.
*/
export async function rewriteRpcModule(
    path: string,
    rpcDir: string,
    target: 'server' | 'client',
    importName: string,
): Promise<{ contents: string; loader: 'ts' } | undefined> {
    if (!path.startsWith(`${rpcDir}/`)) {
        return undefined
    }
    const relativePath = path.slice(rpcDir.length + 1)
    const source = await Bun.file(path).text()
    const url = rpcUrlForFile(relativePath)
    const prepared = prepareRpcModule(source, importName)
    if (!prepared) {
        throw new Error(
            `[belte] src/server/rpc/${relativePath} has no \`export const <name> = <METHOD>(...)\` — every $rpc module must declare exactly one remote function`,
        )
    }
    const expectedName = fileStem(relativePath)
    if (prepared.exportName !== expectedName) {
        throw new Error(
            `[belte] src/server/rpc/${relativePath} exports \`${prepared.exportName}\` but the filename expects \`${expectedName}\` — the export name must match the file's stem`,
        )
    }
    if (target === 'client') {
        /* A durable rpc (`outbox: true`) gets the third arg so its client proxy
           parks unreachable calls onto the outbox. */
        const durableArg = prepared.durable ? ', { outbox: true }' : ''
        const contents = `import { remoteProxy as __belteRemoteProxy__ } from '${importName}/browser/remoteProxy';
export const ${prepared.exportName} = __belteRemoteProxy__(${JSON.stringify(prepared.method)}, ${JSON.stringify(url)}${durableArg});
`
        return { contents, loader: 'ts' }
    }
    const banner = `import { defineRpc as __belteDefineRpc__ } from '${importName}/server/rpc/defineRpc';
`
    return { contents: `${banner}${prepared.rewriteForServer(url)}`, loader: 'ts' }
}
