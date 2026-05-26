import { json } from 'belte/respond'
import { GET } from 'belte/route'

/* GET — args arrive as URL search params. */
export const getEcho = GET<{ message: string }, { method: 'GET'; message: string }>(({ message }) =>
    json({ method: 'GET', message }),
)
