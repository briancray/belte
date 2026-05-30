import type { BundleMenu } from './BundleMenu.ts'

/*
User-authored bundle window configuration, default-exported from an
optional `src/bundle/window.ts`. Baked into the launcher at build time
(via the `belte:bundle-window` virtual) and read directly in dev. Every
field is optional — the launcher falls back to the program name for the
title and to openWebview's defaults for size.

The standard App/Edit/Window menus (Quit, copy/paste, minimize/close) plus the
built-in File menu (Start server / Connect / Disconnect) are always installed.
`menu` adds custom top-level menus between the Edit and Window menus; their items
emit `belte:menu` events the app handles. See BundleMenuItem.
*/
export type BundleWindow = {
    title?: string
    width?: number
    height?: number
    menu?: BundleMenu[]
}
