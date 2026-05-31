---
"@briancray/belte": minor
---

Sockets are now exposed to MCP and the CLI over an HTTP face: each schema-bearing socket contributes a `<name>-tail` read tool/command, plus `<name>-publish` when `clientPublish` is set.
