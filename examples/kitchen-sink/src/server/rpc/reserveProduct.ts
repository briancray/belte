import { error } from '@belte/belte/server/error'
import { json } from '@belte/belte/server/json'
import { POST } from '@belte/belte/server/POST'
import { z } from 'zod'

/*
Typed-error demo. `error.typed(name, status, schema?)` declares a reusable
constructor at module scope. Returning it IS the error — it serializes a
`{ $belteError, data }` body at the status, and the rpc reads the constructor's
branded return type to expose the error on the client's
`reserveProduct.isError(caught, 'outOfStock')` (narrowing `.kind` and the typed
`.data`). There is no `errors:` option and no set to register — the rpc infers
its whole error surface from whichever constructors the handler returns.
*/
const outOfStock = error.typed(
    'outOfStock',
    409,
    z.object({ id: z.string(), restockDays: z.number() }),
)

// Stand-in inventory: id '1' is sold out, id '2' is in stock.
const stock: Record<string, number> = { '1': 0, '2': 5 }
const inputSchema = z.object({ id: z.string() })

export const reserveProduct = POST(
    ({ id }) => (stock[id] ? json({ id, reserved: true }) : outOfStock({ id, restockDays: 3 })),
    { inputSchema, clients: { mcp: true } },
)
