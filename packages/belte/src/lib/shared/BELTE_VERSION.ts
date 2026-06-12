import packageJson from '../../../package.json' with { type: 'json' }

/*
The framework's own version, inlined at build time from belte's package.json
(a compiled binary has no node_modules to read at runtime). Rides the health
payload's `belte` field — truthy for the "is this a belte server" check,
informative for skew diagnosis.
*/
export const BELTE_VERSION: string = packageJson.version
