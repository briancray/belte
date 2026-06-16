import { belteUiPlugin } from '../../src/lib/ui/compile/belteUiPlugin.ts'
import { enterRenderPass } from '../../src/lib/ui/runtime/enterRenderPass.ts'
import { exitRenderPass } from '../../src/lib/ui/runtime/exitRenderPass.ts'
import { nextBlockId } from '../../src/lib/ui/runtime/nextBlockId.ts'

/*
Test preload registering belte-ui's `.belte` loader so fixture pages/components
import and compile through the runtime the server and client bundles use. Replaces
the former Svelte preload — belte-ui is the only UI runtime now, and the reactive
test harnesses are plain `.ts` (belte-ui effect/derived), needing no loader.
*/
Bun.plugin(belteUiPlugin)

/*
Compiled SSR/client bodies run via `new Function` in the unit harnesses reference
the render-pass helpers as bare names (the real bundle imports them). Expose them
globally so those bodies resolve to the real runtime singleton — keeping the
block-id counter shared between a harness's server render and client mount.
*/
const globals = globalThis as Record<string, unknown>
globals.nextBlockId = nextBlockId
globals.enterRenderPass = enterRenderPass
globals.exitRenderPass = exitRenderPass
