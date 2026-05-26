import { json } from 'belte/server/json'
import { PATCH } from 'belte/server/PATCH'

/* PATCH — args arrive in the JSON request body. */
export const patchEcho = PATCH<{ message: string }>(({ message }) =>
    json({ method: 'PATCH' as const, message }),
)
