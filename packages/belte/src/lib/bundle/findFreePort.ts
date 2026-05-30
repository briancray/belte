/*
Asks the OS for an unused TCP port by binding a throwaway Bun server to
port 0 (the kernel assigns a free port), reading the assigned port, then
stopping it immediately. There is an unavoidable race between releasing
the port here and the server child re-binding it, but for a
single-user bundle launch the window is negligible.
*/
export function findFreePort(): number {
    const probe = Bun.serve({ port: 0, fetch: () => new Response() })
    // A TCP server bound to port 0 always reports a numeric assigned port.
    const port = probe.port as number
    probe.stop(true)
    return port
}
