import { json } from 'belte/server/json'
import { POST } from 'belte/server/POST'

/* POST — args arrive in the JSON request body. */
export const createEcho = POST<{ message: string }>(({ message }) =>
    json({ method: 'POST' as const, message }, { status: 201 }),
)
