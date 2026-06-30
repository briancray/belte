/* error.typed(name, status, schema?) declares a single typed-error constructor: returning
   it serializes a `{ $belteError, data }` JSON body at the declared status, and the brand on
   its return type is what the rpc helper reads to type `isError`. */
import { expect, test } from 'bun:test'
import { error } from '../src/lib/server/error.ts'

const passthrough = {
    '~standard': { version: 1, vendor: 't', validate: (v: unknown) => ({ value: v }) },
} as const

test('a data-carrying constructor returns the JSON error Response at its status', async () => {
    const invalidCoupon = error.typed('invalidCoupon', 400, passthrough)
    const res = invalidCoupon({ code: 'EXPIRED' })
    expect(res.status).toBe(400)
    expect(await res.clone().json()).toEqual({
        $belteError: 'invalidCoupon',
        data: { code: 'EXPIRED' },
    })
})

test('a nullary constructor takes no args and omits the data key', async () => {
    const cartEmpty = error.typed('cartEmpty', 409)
    const res = cartEmpty()
    expect(res.status).toBe(409)
    expect(await res.clone().json()).toEqual({ $belteError: 'cartEmpty' })
})

/* Type-only: a nullary constructor (no `data` schema) takes no arguments. */
function _nullaryArity() {
    const cartEmpty = error.typed('cartEmpty', 409)
    // @ts-expect-error a nullary constructor takes no arguments
    cartEmpty('unexpected')
}
void _nullaryArity
