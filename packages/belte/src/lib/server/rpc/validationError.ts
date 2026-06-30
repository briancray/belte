import type { StandardSchemaV1 } from '../../shared/types/StandardSchemaV1.ts'
import type { ValidationErrorData } from '../../shared/types/ValidationErrorData.ts'
import { typedErrorResponse } from '../runtime/typedErrorResponse.ts'
import { fieldErrorsFromIssues } from './fieldErrorsFromIssues.ts'

/*
The framework-reserved `validation` typed error a 422 carries: the raw Standard
Schema `issues` plus the form-friendly field → first-message map. Serialized via
the single typed-error funnel so it rides the same `{ $belteError, data }` body
every typed error uses, with the 422 reason phrase reaching `HttpError.statusText`;
the client parses it back onto `HttpError.kind = 'validation'` / `.data`.
*/
export function validationError(issues: readonly StandardSchemaV1.Issue[]): Response {
    const data: ValidationErrorData = { issues, fields: fieldErrorsFromIssues(issues) }
    return typedErrorResponse('validation', 422, data)
}
