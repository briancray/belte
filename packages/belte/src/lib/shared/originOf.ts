/*
Normalises a reachability target to the origin reachable() keys by. A bare host
string defaults to https (the external-dependency norm); an explicit http://…
is honoured. The HEAD probes this origin root — host connectivity, not endpoint
health — so two paths on the same host share one warm entry.
*/
export function originOf(host: string | URL): string {
    const url = typeof host === 'string' && !/^https?:\/\//i.test(host) ? `https://${host}` : host
    return new URL(url).origin
}
