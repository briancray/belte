import { belteUiPlugin } from '../../src/lib/ui/compile/belteUiPlugin.ts'

/*
Test preload registering belte-ui's `.belte` loader so fixture pages/components
import and compile through the runtime the server and client bundles use. Replaces
the former Svelte preload — belte-ui is the only UI runtime now, and the reactive
test harnesses are plain `.ts` (belte-ui effect/derived), needing no loader.
*/
Bun.plugin(belteUiPlugin)
