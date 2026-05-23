import { GET } from 'belte/route/GET'

export const getNow = GET<undefined, { now: string }>(() =>
    Response.json({ now: new Date().toISOString() }),
)
