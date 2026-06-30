---
"@belte/belte": minor
---

Structured validation errors. An input/file-schema validation failure now returns a typed `422` carrying both the raw Standard Schema `issues` and a form-friendly `fields` (top-level field → first message) map. On the client it surfaces as an `HttpError` with `kind === 'validation'` and `data` shaped as the new exported `ValidationErrorData` type — narrow with `err instanceof HttpError && err.kind === 'validation'`. `HttpError` gains `kind`/`data`, and `error()` accepts a descriptor form (`error({ $belteError, status, data })`) that serializes a `{ $belteError, data }` body parsed back onto those fields on both the plain and streaming decode paths.
