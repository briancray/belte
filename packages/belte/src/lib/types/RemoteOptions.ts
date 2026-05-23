export type RemoteOptions = {
    /*
    When false, no client proxy is generated for this export — the function
    becomes server-only (webhooks, server-to-server). Default is true.
    */
    hydrate?: boolean
}
