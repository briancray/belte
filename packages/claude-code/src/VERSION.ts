import packageJson from '../package.json' with { type: 'json' }

/* This package's own version, inlined into the bundle. The browser `command` pins
`bunx @belte/claude-code@VERSION` to it so a stale global bunx cache can't start a
bridge mismatched with the @belte/claude-code the app actually ships. */
export const VERSION = packageJson.version
