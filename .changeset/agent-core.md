---
"@briancray/belte": minor
---

Add `belte/server/agent`. `agent(engine, messages)` runs a model engine against the app's in-process MCP surface (the same tool/prompt/resource derivation the `/__belte/mcp` HTTP transport uses) and returns an `AsyncIterable<AgentFrame>`, so the handler chooses the transport: `jsonl(agent(engine, messages))` or `sse(...)`. Engines are provider-specific and ship separately (`@belte/anthropic`, `@belte/claude-code`); the tool surface itself stays internal.
