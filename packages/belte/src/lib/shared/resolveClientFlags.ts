import type { ClientFlags } from './types/ClientFlags.ts'

/*
Fills in the missing keys of a user-supplied `clients` option. Browser
defaults to true (the historical surface); mcp/cli default to true only
when a schema is attached, since exposing an unvalidated handler as a
tool / shell command is a foot-gun.
*/
export function resolveClientFlags(
    flags: Partial<ClientFlags> | undefined,
    hasSchema: boolean,
): ClientFlags {
    return {
        browser: flags?.browser ?? true,
        mcp: flags?.mcp ?? hasSchema,
        cli: flags?.cli ?? hasSchema,
    }
}
