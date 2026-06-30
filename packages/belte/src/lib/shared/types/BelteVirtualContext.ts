import type { PagesScan } from './PagesScan.ts'

/*
The plugin-closure state the belte:* virtual loaders read: the project
directories, the per-build memoized scanners / readers (each a `once()` thunk,
so the loaders share a single scan), and the embed flag. Threaded as one object
so belteVirtualModule stays a pure function of its inputs.
*/
export type BelteVirtualContext = {
    cwd: string
    serverDir: string
    cliDir: string
    pagesDir: string
    publicDir: string
    resourcesDir: string
    rpcDir: string
    socketsDir: string
    promptsDir: string
    embedAssets: boolean
    scanRpcOnce: () => Promise<string[]>
    scanSocketsOnce: () => Promise<string[]>
    scanPromptsOnce: () => Promise<string[]>
    scanPagesOnce: () => Promise<PagesScan>
    scanPublicOnce: () => Promise<string[]>
    loadShellOnce: () => Promise<string>
    readPackageJsonOnce: () => Promise<Record<string, unknown> | undefined>
    belteImportNameOnce: () => Promise<string>
    writeHealthDtsOnce: (hasAppModule: boolean) => Promise<void>
}
