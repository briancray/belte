import { GET } from 'belte/rpc'

export const getNow = GET<undefined, { now: string }>(() =>
    Response.json({ now: new Date().toISOString() }),
)
