import { basename, dirname, join } from 'node:path'

/*
Path of the bundle's shipped `.env` — the default config layer written at build
time and read back at boot. Given the directory holding the binaries, returns
where that `.env` lives.

A macOS `.app` nests binaries under `Contents/MacOS`, but `codesign` seals that
directory as *code*: a data file there can't survive signing and reloading. So
for the `.app` layout the `.env` belongs beside the icon in `Contents/Resources`,
which is sealed as a resource. Every other platform keeps the flat layout, with
the `.env` next to the binaries. Pure: computes the path, never touches disk.
*/
export function shippedEnvPath(binaryDir: string): string {
    const isMacAppBinaryDir =
        basename(binaryDir) === 'MacOS' && basename(dirname(binaryDir)) === 'Contents'
    if (isMacAppBinaryDir) {
        return join(dirname(binaryDir), 'Resources', '.env')
    }
    return join(binaryDir, '.env')
}
