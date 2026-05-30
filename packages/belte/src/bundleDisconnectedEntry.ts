import { mount } from 'svelte'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import Disconnected from './_virtual/bundle-disconnected-component.ts'

/*
Client entry for the bundle connect screen. Standalone — it mounts the
disconnected component (the user's src/bundle/disconnected.svelte override or the
lib default, picked by the resolver) into #app, with no router or SSR hydration.
buildDisconnected bundles this into a single self-contained HTML file (the Tailwind
CSS is a separate build entrypoint, not imported here). The `svelte` import sits
first so biome's import sorting leaves the `_virtual` component's `@ts-expect-error`
attached.
*/
const target = document.getElementById('app')
if (target) {
    mount(Disconnected, { target })
}
