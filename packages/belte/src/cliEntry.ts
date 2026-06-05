// @ts-expect-error virtual module resolved by belteResolverPlugin
import { banner, footer } from './_virtual/cli-chrome.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import manifest from './_virtual/cli-manifest.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import programName from './_virtual/cli-name.ts'
import { runCli } from './lib/cli/runCli.ts'

/*
Standalone CLI binary entry. Compiled with `bun build --compile` into
`dist/cli` (or `dist/cli-thin/<platform>/` for cross-builds). The CLI is
a thin remote client — no handler code is bundled; it talks to a running
server over HTTP (BELTE_APP_URL at runtime). The bundler emits:
  - belte:cli-manifest — the per-rpc manifest (method, url, jsonSchema)
  - belte:cli-name     — the program name from package.json
  - belte:cli-chrome   — optional banner/footer text from src/cli/
*/
const exitCode = await runCli({
    programName,
    manifest,
    banner,
    footer,
    argv: process.argv.slice(2),
})
process.exit(exitCode)
