import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEngine, NeutralMessage } from '@belte/belte/server/agent'

/*
The Claude Code engine for belte's `agent()`. `engine(config)` returns an
AgentEngine that drives the Claude Agent SDK headless, pointed at the app's
own MCP endpoint, and relays its event stream as AgentFrames. Unlike the
raw-model engine, Claude Code owns its loop — core only sees frames out.

  // src/server/rpc/chat.ts
  import { agent } from '@belte/belte/server/agent'
  import { jsonl } from '@belte/belte/server/jsonl'
  import { engine } from '@belte/claude-code'
  const chatEngine = engine({ permissionMode: 'bypassPermissions' })
  export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), { inputSchema })

Auth rides whatever Claude Code is logged in with (subscription or API key)
— no key in $server/config. Permission is decided server-side via
`permissionMode`: the app's own tools are already gated by each verb's
declaration, so the mode just sets how Claude Code treats its own built-ins
(prompt, plan-only, or bypass).

NOTE: the @anthropic-ai/claude-agent-sdk message/option shapes are evolving
— verify `query`'s options (mcpServers, permissionMode) and the streamed
message discriminants against the installed SDK version before relying on
this in production.
*/

type ClaudeCodeConfig = {
    /*
    Claude Code's permission mode for the session — `'default'` (prompt on
    dangerous ops), `'acceptEdits'`, `'plan'` (no tool execution), `'dontAsk'`,
    or `'bypassPermissions'`. `'bypassPermissions'` is wired with the SDK's
    required `allowDangerouslySkipPermissions` flag — only choose it for a
    fully trusted, non-interactive server.
    */
    permissionMode?: PermissionMode
    // Bearer for the app's /__belte/mcp endpoint, if it's gated by app.handle/authorize.
    mcpToken?: string
    // MCP server name → tools surface as `mcp__<name>__<tool>`; defaults to "app".
    serverName?: string
}

/*
The SDK's `query` takes a single prompt (or a stream of user-only turns) and owns
assistant/tool turns through its own session, which belte doesn't resume here. So
prior turns are flattened into the prompt as a labelled transcript rather than
dropped — the model keeps the conversation's context without SDK session state.
A lone user turn passes through as its bare text. Tool-result turns are internal
to the prior run and omitted.
*/
function promptFromMessages(messages: NeutralMessage[]): string {
    if (messages.length === 1 && messages[0]?.role === 'user') {
        return messages[0].text
    }
    return messages
        .map((message) => {
            if (message.role === 'user') {
                return `User: ${message.text}`
            }
            if (message.role === 'assistant' && message.text) {
                return `Assistant: ${message.text}`
            }
            return ''
        })
        .filter(Boolean)
        .join('\n\n')
}

export function engine(config: ClaudeCodeConfig = {}): AgentEngine {
    const serverName = config.serverName ?? 'app'
    return async function* ({ messages, origin }) {
        const prompt = promptFromMessages(messages)

        const stream = query({
            prompt,
            options: {
                mcpServers: {
                    [serverName]: {
                        type: 'http',
                        url: `${origin}/__belte/mcp`,
                        ...(config.mcpToken
                            ? { headers: { Authorization: `Bearer ${config.mcpToken}` } }
                            : {}),
                    },
                },
                ...(config.permissionMode ? { permissionMode: config.permissionMode } : {}),
                // The SDK requires this explicit opt-in alongside bypassPermissions.
                ...(config.permissionMode === 'bypassPermissions'
                    ? { allowDangerouslySkipPermissions: true }
                    : {}),
            },
        })

        for await (const message of stream) {
            if (message.type === 'assistant') {
                for (const block of message.message.content) {
                    if (block.type === 'text') {
                        yield { type: 'text', delta: block.text }
                    } else if (block.type === 'tool_use') {
                        yield {
                            type: 'tool_use',
                            id: block.id,
                            name: block.name,
                            input: block.input,
                        }
                    }
                }
            } else if (message.type === 'result') {
                // `success` is a clean finish; every error subtype (max_turns, budget,
                // execution error) is an abnormal stop the client must be able to see.
                yield { type: 'done', stop: message.subtype === 'success' ? 'end' : 'error' }
            }
        }
    }
}
