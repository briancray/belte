import { existsSync } from 'node:fs'
import { Glob } from 'bun'

/*
Walks one registry directory once: src/server/rpc (every `.ts` file is an
HTTP-method rpc handler), src/server/sockets (each `.ts` file declares one
socket, loaded lazily on first sub/pub frame), or src/mcp/prompts (each `.md`
file declares one MCP prompt — frontmatter for metadata, body for the
template). Returns an empty list when the directory doesn't exist so an app
missing the folder builds the same.
*/
export async function scanDir(dir: string, pattern: string): Promise<string[]> {
    if (!existsSync(dir)) {
        return []
    }
    return await Array.fromAsync(new Glob(pattern).scan({ cwd: dir }))
}
