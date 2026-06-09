import { agent } from '@belte/belte/server/agent'
import { jsonl } from '@belte/belte/server/jsonl'
import { POST } from '@belte/belte/server/POST'
import { engine } from '@belte/claude-code'
import { z } from 'zod'

/*
Chat agent over the Claude Code engine. `agent(engine, messages)` runs the
engine against this app's own MCP surface — every schema-bearing, mcp-exposed
verb (getProduct, getRates, countLog, …) is a tool the model may call — and
returns its AgentFrame stream. The handler frames it with `jsonl()`, so the
browser reads it line-by-line like any other streaming rpc.

Claude Code authenticates with whatever it's logged in with (a subscription or
an API key), so there's no key in `$server/config` — the host running the
server must have Claude Code available.

Permission is the server's call, so the posture is fixed here, not taken from
the client: `tools: []` drops every Claude Code built-in (no Bash/Read/Write
against the host), leaving only this app's `mcp__app__*` verbs, and
`defaultMode: 'dontAsk'` denies anything not pre-approved instead of prompting
— so the `allow` list is the whole capability surface. The agent can call
getProduct and getRates; every other verb (countLog, createEcho, …) is denied.
*/

// Mirrors NeutralMessage from belte/server/agent — the provider-neutral turn shape.
const message = z.discriminatedUnion('role', [
    z.object({ role: z.literal('user'), text: z.string() }),
    z.object({
        role: z.literal('assistant'),
        text: z.string().optional(),
        toolUses: z
            .array(z.object({ id: z.string(), name: z.string(), input: z.unknown() }))
            .optional(),
    }),
    z.object({
        role: z.literal('tool'),
        results: z.array(
            z.object({ id: z.string(), content: z.string(), isError: z.boolean().optional() }),
        ),
    }),
])

const inputSchema = z.object({
    messages: z.array(message),
})

/*
Deny-all-but-allowlist: no built-ins (`tools: []`), `dontAsk` denies anything
unlisted, and `allow` names the two read verbs the agent may call. Static, so
the engine is built once at module load rather than per request.
*/
const chatEngine = engine({
    tools: [],
    permissions: {
        defaultMode: 'dontAsk',
        allow: ['mcp__app__*'],
    },
})

/*
POST with a schema but no explicit `clients.mcp`, so it stays off the MCP
surface — the agent verb is never itself a tool, which keeps the agent from
being handed a tool that re-enters the agent. `clients.cli` is off too: a
messages-array turn isn't a meaningful CLI subcommand. Browser-only.
*/
export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), {
    inputSchema,
    clients: { cli: false },
})
