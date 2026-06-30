/*
Internal slot the browser outbox registry registers its prober into, so the shared
`pending()` probe can count parked durable writes without shared/ importing browser/. The
prober taps each queue's lifecycle channel (reactive inside $derived / $effect) and reports
whether a durable rpc's selector — or the bare form, spanning every queue — has an
undelivered entry; optional args narrow to one parked call. When no prober is registered
(server render, or the outbox was never imported) `pending()` simply omits the outbox term.
A parked write only ever counts as `pending`, never `refreshing`.
*/
export const outboxProbeSlot: {
    probe: ((selector: unknown, args: unknown) => boolean) | undefined
} = {
    probe: undefined,
}
