import { expect, test } from 'bun:test'
import { typedErrorResponse } from '../src/lib/server/runtime/typedErrorResponse.ts'

test('serializes { $belteError, data } JSON at the given status with reason phrase', async () => {
    const res = typedErrorResponse('invalidCoupon', 400, { code: 'EXPIRED' })
    expect(res.status).toBe(400)
    expect(res.statusText).toBe('Bad Request')
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.clone().json()).toEqual({
        $belteError: 'invalidCoupon',
        data: { code: 'EXPIRED' },
    })
})

test('omits data key when data is undefined (nullary error)', async () => {
    const res = typedErrorResponse('cartEmpty', 409, undefined)
    expect(res.status).toBe(409)
    expect(await res.clone().json()).toEqual({ $belteError: 'cartEmpty' })
})

test('falls back to HTTP <status> for an unlisted status code', () => {
    expect(typedErrorResponse('teapot', 418, undefined).statusText).toBe('HTTP 418')
})
