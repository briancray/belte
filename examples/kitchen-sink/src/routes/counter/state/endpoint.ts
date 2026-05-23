import { DELETE } from 'belte/route/DELETE'
import { GET } from 'belte/route/GET'
import { POST } from 'belte/route/POST'

/*
Module-level state stands in for a database for this demo. A real app would
read/write a row here — the $derived.by + cache.invalidate pattern is the same.
*/
let count = 0

export const getCounter = GET<undefined, { count: number }>(() => Response.json({ count }))

export const incrementCounter = POST<undefined, { count: number }>(() => {
    count += 1
    return Response.json({ count })
})

export const resetCounter = DELETE<undefined, { count: number }>(() => {
    count = 0
    return Response.json({ count })
})
