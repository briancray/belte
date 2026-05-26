import { json } from 'belte/server/json'
import { DELETE } from 'belte/server/DELETE'

/* DELETE — args arrive as URL search params (no body for DELETE/HEAD/GET). */
export const deleteEcho = DELETE<{ message: string }>(({ message }) =>
    json({ method: 'DELETE' as const, message }),
)
