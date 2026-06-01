import { dirname } from 'node:path'
import { loadEnvFile } from '../shared/loadEnvFile.ts'
import { shippedEnvPath } from '../shared/shippedEnvPath.ts'

/*
Loads the bundle's shipped `.env` into `process.env`, resolved from the running
binary's directory (`process.execPath`) via shippedEnvPath — beside the binary in
the flat layout, under `Contents/Resources` in a macOS `.app`. This is the file the
install tarball ships beside the executable — and, for a bundle, the one `bundleApp`
copies from the project's `.env.bundle`. It carries the app's shipped defaults; the
fill-when-unset merge (see loadEnvFile) lets per-shell exports, Bun's CWD
`.env`, and the user's data-dir config all override it.
*/
export async function loadEnvFromBinaryDir(): Promise<void> {
    await loadEnvFile(shippedEnvPath(dirname(process.execPath)))
}
