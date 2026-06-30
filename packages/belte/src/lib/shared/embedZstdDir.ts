import { belteLog } from './belteLog.ts'

/*
Encodes every file in `files` (relative to `dir`) into a base64 zstd map and
emits `export const <exportName> = { "<key>": _d("<base64>") }`. `keyFor` maps
a relative path to its lookup key; `precompressed` true means the files are
already `.zst` on disk (read + base64 as-is), false means compress here at
level 22. Shared by the belte:assets / belte:public-assets / belte:mcp-resources
virtuals, which differ only in source dir, key shape, and whether the inputs
are pre-compressed.
*/
export async function embedZstdDir({
    dir,
    files,
    keyFor,
    precompressed,
    exportName,
    label,
    source,
}: {
    dir: string
    files: string[]
    keyFor: (file: string) => string
    precompressed: boolean
    exportName: string
    label: string
    source: string
}): Promise<string> {
    const encoded = await Promise.all(
        files.map(async (file) => {
            const raw = await Bun.file(`${dir}/${file}`).bytes()
            const bytes = precompressed ? raw : await Bun.zstdCompress(raw, { level: 22 })
            return {
                line: `    ${JSON.stringify(keyFor(file))}: _d(${JSON.stringify(bytes.toBase64())}),`,
                bytes: bytes.byteLength,
            }
        }),
    )
    const totalBytes = encoded.reduce((total, entry) => total + entry.bytes, 0)
    const unit = precompressed ? 'KiB' : 'KiB zstd'
    belteLog.info(
        `embedded ${encoded.length} ${label} from ${source} (${(totalBytes / 1024).toFixed(1)} ${unit})`,
    )
    return `const _d = (s) => Uint8Array.fromBase64(s)
export const ${exportName} = {
${encoded.map((entry) => entry.line).join('\n')}
}
`
}
