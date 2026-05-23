/*
Maps a route-relative path to its URL route. Routes are folder-based: every
leaf segment is `page.svelte`, `layout.svelte`, or `endpoint.ts`, and the
URL is simply the directory path. The only files allowed at the routes/
root are these three — they map to `/`. Pages mount at the directory path,
layouts at the directory prefix, and endpoints at the directory path.
*/
export function routeForFile(relPath: string): string {
    const segments = relPath.split('/')
    segments.pop()
    const path = segments.filter(Boolean).join('/')
    return path === '' ? '/' : `/${path}`
}
