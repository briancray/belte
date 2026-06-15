import type { BunPlugin } from 'bun'
import { compileModule } from './compileModule.ts'

/*
Bun plugin that loads `.belte` single-file components: compiles each to the ES
module `compileModule` emits, so they import and mount like any other module. The
only UI loader in the dev/build/preload pipeline; the emitted module's
`@belte/belte/ui/*` imports resolve through the package exports.
*/
// @readme plumbing
export const belteUiPlugin: BunPlugin = {
    name: 'belte-ui',
    setup(build) {
        build.onLoad({ filter: /\.belte$/ }, async (args) => ({
            contents: compileModule(await Bun.file(args.path).text()),
            loader: 'js',
        }))
    },
}
