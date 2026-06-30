---
"@belte/belte": minor
---

Rename "verb" terminology to "rpc" throughout. The public export `belte/server/rpc/defineVerb` is now `belte/server/rpc/defineRpc`, and the `HttpVerb` type is now `HttpMethod`. The inspector surface JSON field `verbs` is now `rpcs`. The GET/POST/PUT/PATCH/DELETE/HEAD helpers and `isReadOnlyMethod` are unchanged (they are named for the HTTP method, which is correct).
