import type { HttpVerb } from '../../server/rpc/types/HttpVerb.ts'

/*
Per-RPC manifest entry baked into the standalone CLI binary by the
bundler when APP_URL was set at build time. Carries enough info to make
the right HTTP request without importing the handler module (which the
thin build doesn't ship).
*/
export type CliManifestEntry = {
    method: HttpVerb
    url: string
    jsonSchema?: Record<string, unknown>
}
