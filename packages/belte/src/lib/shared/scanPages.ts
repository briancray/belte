import { existsSync } from 'node:fs'
import { Glob } from 'bun'
import type { PagesScan } from './types/PagesScan.ts'

/*
Walks src/browser/pages once and partitions every `.svelte` file into pages,
layouts, and error pages. Rejects any other file shape — every leaf must live in
its own folder (or directly under `src/browser/pages/` for the root) and the
basename must be `page.svelte`, `layout.svelte`, or `error.svelte`. A misnamed
file (e.g. `about.svelte`) would otherwise be silently ignored; the explicit
error gives the right hint.
*/
export async function scanPages(pagesDir: string): Promise<PagesScan> {
    if (!existsSync(pagesDir)) {
        return { pageFiles: [], layoutFiles: [], errorFiles: [] }
    }
    const allFiles = await Array.fromAsync(new Glob('**/*.svelte').scan({ cwd: pagesDir }))
    const pageFiles: string[] = []
    const layoutFiles: string[] = []
    const errorFiles: string[] = []
    for (const file of allFiles) {
        const basename = file.split('/').pop() ?? ''
        if (basename === 'page.svelte') {
            pageFiles.push(file)
            continue
        }
        if (basename === 'layout.svelte') {
            layoutFiles.push(file)
            continue
        }
        if (basename === 'error.svelte') {
            errorFiles.push(file)
            continue
        }
        const stem = basename.replace(/\.[^.]+$/, '')
        const parent = file.includes('/') ? `${file.slice(0, file.lastIndexOf('/'))}/` : ''
        throw new Error(
            `[belte] src/browser/pages/${file} is not a recognized page file — every page must live in its own folder as page.svelte, layout.svelte, or error.svelte (try src/browser/pages/${parent}${stem}/page.svelte)`,
        )
    }
    return { pageFiles, layoutFiles, errorFiles }
}
