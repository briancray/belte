// @readme plumbing
import { plugin } from 'bun'
import { belteResolverPlugin } from './belteResolverPlugin.ts'
import { belteUiPlugin } from './lib/ui/compile/belteUiPlugin.ts'

const mode = (process.env.BELTE_TARGET ?? 'server') as 'server' | 'client'

await plugin(belteUiPlugin)
await plugin(belteResolverPlugin({ target: mode }))

await plugin({
    name: 'css-noop',
    setup(build) {
        build.onLoad({ filter: /\.css$/ }, () => ({
            contents: 'export default {};',
            loader: 'js',
        }))
    },
})
