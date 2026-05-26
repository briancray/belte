import { json } from 'belte/server/json'
import { GET } from 'belte/server/GET'

/* GET — args arrive as URL search params. */
export const getEcho = GET<{ message: string }>(({ message }) =>
    json({ method: 'GET' as const, message }),
)
