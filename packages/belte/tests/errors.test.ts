import { expect, test } from 'bun:test'
import { errors } from '../src/lib/server/errors.ts'

const passthrough = {
    '~standard': { version: 1, vendor: 't', validate: (v: unknown) => ({ value: v }) },
} as const

test('a data-carrying constructor returns the JSON error Response at its status', async () => {
    const set = errors({ invalidCoupon: { status: 400, data: passthrough } })
    const res = set.invalidCoupon({ code: 'EXPIRED' })
    expect(res.status).toBe(400)
    expect(await res.clone().json()).toEqual({
        $belteError: 'invalidCoupon',
        data: { code: 'EXPIRED' },
    })
})

test('a nullary constructor takes no args and omits the data key', async () => {
    const set = errors({ cartEmpty: { status: 409 } })
    const res = set.cartEmpty()
    expect(res.status).toBe(409)
    expect(await res.clone().json()).toEqual({ $belteError: 'cartEmpty' })
})
