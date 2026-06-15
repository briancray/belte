import type { UiComponent } from '../../ui/runtime/types/UiComponent.ts'

/*
Manifest of route URL → page.belte module loader. Produced by the resolver plugin
from `page.belte` files anywhere under src/browser/pages. Layouts are userland in
belte-ui (a page imports and wraps its own), so there is no layout/error manifest.
*/
export type Pages = Record<string, () => Promise<{ default: UiComponent }>>
