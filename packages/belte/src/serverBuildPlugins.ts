import type { BunPlugin } from 'bun'
import { belteResolverPlugin } from './belteResolverPlugin.ts'
import { belteUiPlugin } from './lib/ui/compile/belteUiPlugin.ts'

/*
The server-target Bun.build plugin pair shared by compile / buildCli / bundleApp:
the belte-ui `.belte` loader (so SSR `render()` resolves) plus belte's virtual-
module resolver. `embedAssets` flips on the zstd asset embed used by the
standalone server binary; the CLI + launcher builds leave it off.
*/
export function serverBuildPlugins({
    cwd,
    embedAssets = false,
}: {
    cwd: string
    embedAssets?: boolean
}): BunPlugin[] {
    return [belteUiPlugin, belteResolverPlugin({ cwd, embedAssets, target: 'server' })]
}
