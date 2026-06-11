import type { ClaudePermissions } from './ClaudePermissions.ts'

/*
The one mapping from the package's MCP + permission contract to `claude` CLI
flags, shared by both binary-spawning faces (cliEngine headless, launch
interactive) so the isolation triple and the permission grammar can't drift
between them: `--mcp-config` wires the app server, `--strict-mcp-config` +
`--setting-sources ''` isolate from the host's ambient servers and settings,
`--permission-mode` carries the session mode and `--settings` the
allow/ask/deny rules. `headless` pairs bypassPermissions with the explicit
`--dangerously-skip-permissions` opt-in the print mode requires; the
interactive TUI omits it so claude can confirm the bypass with the user.
*/
export function claudeCliArgs({
    servers,
    permissions,
    headless,
}: {
    servers: Record<string, unknown>
    permissions?: ClaudePermissions
    headless: boolean
}): string[] {
    const args = [
        '--mcp-config',
        JSON.stringify({ mcpServers: servers }),
        '--strict-mcp-config',
        '--setting-sources',
        '',
    ]
    const { defaultMode, ...rules } = permissions ?? {}
    if (defaultMode) {
        args.push('--permission-mode', defaultMode)
    }
    if (headless && defaultMode === 'bypassPermissions') {
        args.push('--dangerously-skip-permissions')
    }
    if (Object.keys(rules).length) {
        args.push('--settings', JSON.stringify({ permissions: rules }))
    }
    return args
}
