/*
Monotonic counter bumped whenever the rpc / socket / prompt registries
mutate. The MCP surface memoizes its tools / prompts projection against
this revision so a static surface projects its JSON Schemas once instead
of on every tools/list — while any registration (a lazy first-construction
insert, or a fresh app in tests) still busts the memo.
*/
export const registryRevision = {
    value: 0,
    bump(): void {
        registryRevision.value += 1
    },
}
