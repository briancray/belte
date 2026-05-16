import { existsSync } from 'node:fs'
import type { SvelteConfig } from './SvelteConfig.ts'

const EXTENSIONS = ['js', 'mjs', 'ts'] as const

export async function loadSvelteConfig(cwd: string = process.cwd()): Promise<SvelteConfig> {
    for (const ext of EXTENSIONS) {
        const path = `${cwd}/svelte.config.${ext}`
        if (existsSync(path)) {
            const mod = await import(path)
            return mod.default as SvelteConfig
        }
    }
    return {}
}
