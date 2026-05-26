/*
Wire frame the browser sends over the multiplexed stream connection.
`sub` opens a subscription against `stream`; `tail: true` skips the
history replay. `unsub` closes one. `pub` publishes a message — the
dispatcher checks the topic's `clientPublish` flag before fanning out.

`sub` is the per-subscription id minted client-side; the server treats
it as opaque and routes inbound `msg|err|end` frames back to the same
id so one ws can multiplex many subscriptions to the same or different
streams.
*/
export type StreamClientFrame =
    | { type: 'sub'; sub: string; stream: string; tail?: boolean }
    | { type: 'unsub'; sub: string }
    | { type: 'pub'; stream: string; message: unknown }
