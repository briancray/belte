import { describe, expect, test } from 'bun:test'
import { error } from '../src/lib/server/error.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { fieldErrorsFromIssues } from '../src/lib/server/rpc/fieldErrorsFromIssues.ts'
import { validationError } from '../src/lib/server/rpc/validationError.ts'
import { HttpError } from '../src/lib/shared/HttpError.ts'
import { streamResponse } from '../src/lib/shared/streamResponse.ts'
import type { StandardSchemaV1 } from '../src/lib/shared/types/StandardSchemaV1.ts'
import type { ValidationErrorData } from '../src/lib/shared/types/ValidationErrorData.ts'

/* A Standard Schema that always rejects with the given issues. */
function rejectingSchema(issues: readonly StandardSchemaV1.Issue[]): StandardSchemaV1 {
    return {
        '~standard': {
            version: 1,
            vendor: 'belte-test',
            validate: () => ({ issues }),
        },
    }
}

describe('fieldErrorsFromIssues', () => {
    test('flattens issues to a top-level field → first-message map', () => {
        const fields = fieldErrorsFromIssues([
            { message: 'Required', path: ['email'] },
            { message: 'Too short', path: ['password'] },
        ])
        expect(fields).toEqual({ email: 'Required', password: 'Too short' })
    })

    test('first message wins per field; later ones for the same field are dropped', () => {
        const fields = fieldErrorsFromIssues([
            { message: 'Required', path: ['email'] },
            { message: 'Invalid', path: ['email'] },
        ])
        expect(fields).toEqual({ email: 'Required' })
    })

    test('normalizes object-wrapped path segments ({ key })', () => {
        const fields = fieldErrorsFromIssues([{ message: 'Required', path: [{ key: 'email' }] }])
        expect(fields).toEqual({ email: 'Required' })
    })

    test('omits root-level issues that have no string field', () => {
        const fields = fieldErrorsFromIssues([{ message: 'Object expected', path: undefined }])
        expect(fields).toEqual({})
    })
})

describe('validationError', () => {
    test('returns a 422 carrying issues + fields under a validation descriptor', async () => {
        const issues: StandardSchemaV1.Issue[] = [{ message: 'Required', path: ['email'] }]
        const response = validationError(issues)
        expect(response.status).toBe(422)
        expect(response.statusText).toBe('Unprocessable Content')
        expect(await response.json()).toEqual({
            $belteError: 'validation',
            data: { issues, fields: { email: 'Required' } },
        })
    })
})

describe('a validation 422 surfaces as a typed HttpError on the client decode', () => {
    test('input-schema failure throws HttpError with kind validation and ValidationErrorData', async () => {
        const create = defineRpc('POST', '/rpc/validate-create', () => error(500, 'unreachable'), {
            inputSchema: rejectingSchema([{ message: 'Required', path: ['email'] }]),
        })

        const caught = await create({ email: '' } as never).then(
            () => undefined,
            (thrown: unknown) => thrown,
        )

        expect(caught).toBeInstanceOf(HttpError)
        const httpError = caught as HttpError
        expect(httpError.status).toBe(422)
        expect(httpError.kind).toBe('validation')
        const data = httpError.data as ValidationErrorData
        expect(data.fields).toEqual({ email: 'Required' })
        expect(data.issues).toEqual([{ message: 'Required', path: ['email'] }])
    })

    test('a plain error(status, text) stays a plain HttpError — no kind/data', async () => {
        const get = defineRpc('GET', '/rpc/plain-error', () => error(404, 'not found'))
        const caught = await get().then(
            () => undefined,
            (thrown: unknown) => thrown,
        )
        expect(caught).toBeInstanceOf(HttpError)
        expect((caught as HttpError).kind).toBeUndefined()
        expect((caught as HttpError).data).toBeUndefined()
    })

    test('the streaming decode path surfaces the same typed error on first pull', async () => {
        const response = validationError([{ message: 'Required', path: ['email'] }])
        const iterator = streamResponse(response)[Symbol.asyncIterator]()
        const caught = await iterator.next().then(
            () => undefined,
            (thrown: unknown) => thrown,
        )
        expect(caught).toBeInstanceOf(HttpError)
        expect((caught as HttpError).kind).toBe('validation')
    })
})
