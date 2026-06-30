# Typed-error `errors()` Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the handler's `ctx.errors` second-arg with a module-scope `errors()` factory whose constructors return a `TypedResponse` directly, removing the `error(descriptor)` indirection.

**Architecture:** A new server export `errors(spec)` builds a callable constructor set; each constructor serializes its JSON error `Response` via a shared internal `typedErrorResponse`. The same object is passed to the rpc `errors:` option, where its declared `ErrorSet<Spec>` type carries `Spec` as a phantom brand so `Errors` still infers and flows to `RemoteFunction` for client `rpc.isError`. The handler loses its `ctx` param. `error()` reverts to ad-hoc plain-text only.

**Tech Stack:** Bun, TypeScript (typechecked with tsgo), Biome (`bun format`), Standard Schema, Svelte 5 (unaffected here).

## Global Constraints

- Bun + JS-native APIs only; no Node APIs.
- One export per file, named after the export; no barrels/`index.ts`.
- Constants UPPERCASE_SNAKE_CASE, including their filenames.
- `undefined` (not `null`) for nullish values.
- `lib/shared/*` must not import from `lib/server/*` (the namespace split). `TypedResponse` is server-only.
- Every `package.json` `exports` entry carries a `// @readme <slug>` comment directly above it.
- Multiline comments `/* */`, single-line `//`; comment functions and non-obvious blocks tersely.
- Run `bun format` on every touched file before committing.
- Wire format, HTTP status, `statusText`, `HttpError.kind`/`.data`, and the `rpc.isError` overloads (declared names + reserved `validation` + `queued`) MUST remain byte-identical — they are the behavioral contract.

All commands run from `/Users/briancray/Code/belte`. Tests run from `packages/belte` (or root for typecheck — tsgo is cwd-sensitive; CI truth is the repo root).

---

### Task 1: Extract `STATUS_TEXT` + `typedErrorResponse` (green refactor)

Pull the JSON-error serializer and the status reason-phrase map out of `error.ts` into reusable internal modules, and route both existing producers (`error()`'s descriptor branch and `validationError`) through the serializer. No behavior change. `error(descriptor)` overload and `ctx.errors` stay for now.

**Files:**
- Create: `packages/belte/src/lib/server/runtime/STATUS_TEXT.ts`
- Create: `packages/belte/src/lib/server/runtime/typedErrorResponse.ts`
- Modify: `packages/belte/src/lib/server/error.ts`
- Modify: `packages/belte/src/lib/server/rpc/validationError.ts`
- Test: `packages/belte/tests/typedErrorResponse.test.ts`

**Interfaces:**
- Produces: `STATUS_TEXT: Record<number, string>`; `typedErrorResponse(name: string, status: number, data: unknown): TypedResponse<never>`.
- Consumes: `withResponseDefaults` (`lib/server/runtime/withResponseDefaults.ts`), `NO_STORE` (`lib/shared/CACHE_CONTROL_VALUES.ts`), `TypedResponse` (`lib/server/rpc/types/TypedResponse.ts`).

- [ ] **Step 1: Write the failing test**

Create `packages/belte/tests/typedErrorResponse.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { typedErrorResponse } from '../src/lib/server/runtime/typedErrorResponse.ts'

test('serializes { $belteError, data } JSON at the given status with reason phrase', async () => {
    const res = typedErrorResponse('invalidCoupon', 400, { code: 'EXPIRED' })
    expect(res.status).toBe(400)
    expect(res.statusText).toBe('Bad Request')
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.clone().json()).toEqual({ $belteError: 'invalidCoupon', data: { code: 'EXPIRED' } })
})

test('omits data key when data is undefined (nullary error)', async () => {
    const res = typedErrorResponse('cartEmpty', 409, undefined)
    expect(res.status).toBe(409)
    expect(await res.clone().json()).toEqual({ $belteError: 'cartEmpty' })
})

test('falls back to HTTP <status> for an unlisted status code', () => {
    expect(typedErrorResponse('teapot', 418, undefined).statusText).toBe('HTTP 418')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/belte && bun test tests/typedErrorResponse.test.ts`
Expected: FAIL — cannot resolve `../src/lib/server/runtime/typedErrorResponse.ts`.

- [ ] **Step 3: Create `STATUS_TEXT.ts`**

Create `packages/belte/src/lib/server/runtime/STATUS_TEXT.ts` (verbatim copy of the map from `error.ts`):

```ts
/*
Standard reason phrases for the statuses belte sets explicitly. Bun's `Response`
does not populate `statusText` from the status code, so there's no platform table
to read. Unlisted codes fall back to `HTTP <status>` at the call site.
*/
export const STATUS_TEXT: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    409: 'Conflict',
    410: 'Gone',
    413: 'Content Too Large',
    422: 'Unprocessable Content',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
}
```

- [ ] **Step 4: Create `typedErrorResponse.ts`**

Create `packages/belte/src/lib/server/runtime/typedErrorResponse.ts`:

```ts
import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import type { TypedResponse } from '../rpc/types/TypedResponse.ts'
import { STATUS_TEXT } from './STATUS_TEXT.ts'
import { withResponseDefaults } from './withResponseDefaults.ts'

/*
Serializes a typed error as a `{ $belteError, data }` JSON body at `status`, with
the status reason phrase as statusText so it reaches `HttpError.statusText` on the
client (which parses the body back onto `HttpError.kind` / `.data`). `data` of
`undefined` drops the key (nullary errors). The single serializer shared by the
`errors()` constructors and the framework-reserved `validation` error.
*/
export function typedErrorResponse(
    name: string,
    status: number,
    data: unknown,
): TypedResponse<never> {
    return new Response(
        JSON.stringify({ $belteError: name, data }),
        withResponseDefaults(
            { statusText: STATUS_TEXT[status] ?? `HTTP ${status}` },
            { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE },
            status,
        ),
    ) as TypedResponse<never>
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/belte && bun test tests/typedErrorResponse.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Route `error.ts` descriptor branch + `validationError` through the serializer**

In `packages/belte/src/lib/server/error.ts`: replace the local `STATUS_TEXT` const with an import, and replace the descriptor branch body with a call to `typedErrorResponse`. Add near the top imports:

```ts
import { STATUS_TEXT } from './runtime/STATUS_TEXT.ts'
import { typedErrorResponse } from './runtime/typedErrorResponse.ts'
```

Delete the local `const STATUS_TEXT: Record<number, string> = { … }` block. Replace the descriptor branch (the `if (typeof statusOrDescriptor === 'object') { … }` body) with:

```ts
    if (typeof statusOrDescriptor === 'object') {
        const descriptor = statusOrDescriptor
        return typedErrorResponse(descriptor.$belteError, descriptor.status, descriptor.data)
    }
```

Leave the rest of `error()` (signatures, ad-hoc plain-text path) unchanged — the ad-hoc path still reads `STATUS_TEXT[status]` via the import.

In `packages/belte/src/lib/server/rpc/validationError.ts`: replace the `error()` import and call:

```ts
import type { StandardSchemaV1 } from '../../shared/types/StandardSchemaV1.ts'
import type { ValidationErrorData } from '../../shared/types/ValidationErrorData.ts'
import { fieldErrorsFromIssues } from './fieldErrorsFromIssues.ts'
import { typedErrorResponse } from '../runtime/typedErrorResponse.ts'

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
```

- [ ] **Step 7: Run the full suite + typecheck to confirm no regression**

Run: `cd packages/belte && bun test 2>&1 | tail -20`
Expected: all pass (existing `rpcTypedErrors.test.ts` still green — `error(descriptor)` and `ctx.errors` unchanged).
Run: `cd /Users/briancray/Code/belte && bun run typecheck 2>&1 | tail -20`
Expected: clean.

- [ ] **Step 8: Format + commit**

```bash
cd /Users/briancray/Code/belte
bun format packages/belte/src/lib/server/runtime/STATUS_TEXT.ts packages/belte/src/lib/server/runtime/typedErrorResponse.ts packages/belte/src/lib/server/error.ts packages/belte/src/lib/server/rpc/validationError.ts packages/belte/tests/typedErrorResponse.test.ts
git add -A
git commit -m "refactor(belte): extract typedErrorResponse + STATUS_TEXT serializer"
```

---

### Task 2: `errors()` factory + drop `ctx.errors` (atomic API swap)

Add the brand key, `ErrorSet`, the `errors()` factory; flip `ErrorConstructors` to return `TypedResponse<never>` (and relocate it to `server/`); delete `buildErrorConstructors`; drop the handler `ctx` param; wire `defineRpc`/`RpcHelper`. This is one atomic change — the type graph is not green until all of it lands. Migrate `rpcTypedErrors.test.ts` to the factory form in the same task.

**Files:**
- Create: `packages/belte/src/lib/server/rpc/types/ERROR_SPEC.ts`
- Create: `packages/belte/src/lib/server/rpc/types/ErrorSet.ts`
- Create: `packages/belte/src/lib/server/errors.ts`
- Move + modify: `packages/belte/src/lib/shared/types/ErrorConstructors.ts` → `packages/belte/src/lib/server/rpc/types/ErrorConstructors.ts`
- Modify: `packages/belte/src/lib/server/rpc/types/RemoteHandler.ts`
- Modify: `packages/belte/src/lib/server/rpc/types/RpcHelper.ts`
- Modify: `packages/belte/src/lib/server/rpc/defineRpc.ts`
- Delete: `packages/belte/src/lib/server/rpc/buildErrorConstructors.ts`
- Test: `packages/belte/tests/errors.test.ts` (new), `packages/belte/tests/rpcTypedErrors.test.ts` (rewrite)

**Interfaces:**
- Produces: `errors<const Spec extends ErrorSpec>(spec: Spec): ErrorSet<Spec>`; `ErrorSet<Spec> = ErrorConstructors<Spec> & { readonly [ERROR_SPEC]?: Spec }`; `ErrorConstructors<Spec>` constructors return `TypedResponse<never>`.
- Consumes: `typedErrorResponse` (Task 1), `ErrorSpec` (`lib/shared/types/ErrorSpec.ts`), `TypedResponse`, `StandardSchemaV1`.
- Changes: `RemoteHandler<Args, Return>` (drops the `Errors` generic + `ctx` param); `RpcHelper` schema overloads take `errors?: ErrorSet<Errors>`; `defineRpc` no longer builds or passes ctx.

- [ ] **Step 1: Write the failing tests**

Create `packages/belte/tests/errors.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { errors } from '../src/lib/server/errors.ts'

const passthrough = {
    '~standard': { version: 1, vendor: 't', validate: (v: unknown) => ({ value: v }) },
} as const

test('a data-carrying constructor returns the JSON error Response at its status', async () => {
    const set = errors({ invalidCoupon: { status: 400, data: passthrough } })
    const res = set.invalidCoupon({ code: 'EXPIRED' })
    expect(res.status).toBe(400)
    expect(await res.clone().json()).toEqual({ $belteError: 'invalidCoupon', data: { code: 'EXPIRED' } })
})

test('a nullary constructor takes no args and omits the data key', async () => {
    const set = errors({ cartEmpty: { status: 409 } })
    const res = set.cartEmpty()
    expect(res.status).toBe(409)
    expect(await res.clone().json()).toEqual({ $belteError: 'cartEmpty' })
})
```

Rewrite `packages/belte/tests/rpcTypedErrors.test.ts`'s `buy` rpc (around lines 36–46) from the `ctx`/`error(...)` form to the factory form. Replace:

```ts
const couponSpec = { invalidCoupon: { status: 400, data: passthrough } } as const

const buy = defineRpc(
    'POST',
    '/rpc/buy',
    (_args, ctx) => {
        const errors = ctx.errors as ErrorConstructors<typeof couponSpec>
        return error(errors.invalidCoupon({ code: 'EXPIRED' }))
    },
    { inputSchema: passthrough, errors: couponSpec },
)
```

with:

```ts
const couponErrors = errors({ invalidCoupon: { status: 400, data: passthrough } })

const buy = defineRpc(
    'POST',
    '/rpc/buy',
    () => couponErrors.invalidCoupon({ code: 'EXPIRED' }),
    { inputSchema: passthrough, errors: couponErrors },
)
```

Update that file's imports: add `import { errors } from '../src/lib/server/errors.ts'`; remove the now-unused `ErrorConstructors` import and the `error` import if no longer referenced elsewhere in the file (keep `error` only if another test still uses it — check before removing). Leave every `expect(...)` assertion on wire shape / status / `isError` narrowing unchanged.

Add a compile-time inference check to `rpcTypedErrors.test.ts` (mirrors the existing `_narrows` type-only function — defined, never invoked, so `POST`'s runtime throw never fires):

```ts
import { POST } from '../src/lib/server/POST.ts'

/* Type-only: `Errors` infers off the `errors:` opt (no cast), flows to the
   returned fn's `isError`, narrowing both `.kind` and `.data`. */
const stockSchema = {
    '~standard': {
        version: 1,
        vendor: 't',
        validate: (v: unknown) => ({ value: v as { available: number } }),
    },
} as const
function _inferenceCheck(caught: unknown): number | undefined {
    const stockErrors = errors({ outOfStock: { status: 409, data: stockSchema } })
    const sell = POST((_args: { sku: string }) => stockErrors.outOfStock({ available: 0 }), {
        inputSchema: stockSchema,
        errors: stockErrors,
    })
    if (sell.isError(caught, 'outOfStock')) {
        return caught.data.available
    }
    return undefined
}
void _inferenceCheck
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/belte && bun test tests/errors.test.ts tests/rpcTypedErrors.test.ts`
Expected: FAIL — cannot resolve `../src/lib/server/errors.ts`.

- [ ] **Step 3: Create the brand key `ERROR_SPEC.ts`**

Create `packages/belte/src/lib/server/rpc/types/ERROR_SPEC.ts`:

```ts
/*
Type-level brand key on `ErrorSet`, carrying the declared `ErrorSpec` so `Errors`
infers off the rpc `errors:` option (TS can't reverse a mapped `ErrorConstructors`
back to its `Spec` without a direct `Spec` position). Declared, never assigned —
emits no runtime value and is used only in type positions.
*/
export declare const ERROR_SPEC: unique symbol
```

- [ ] **Step 4: Move + flip `ErrorConstructors`**

Create `packages/belte/src/lib/server/rpc/types/ErrorConstructors.ts` (return type now `TypedResponse<never>`; no `ErrorDescriptor`):

```ts
import type { ErrorSpec } from '../../../shared/types/ErrorSpec.ts'
import type { StandardSchemaV1 } from '../../../shared/types/StandardSchemaV1.ts'
import type { TypedResponse } from './TypedResponse.ts'

/*
The callable error constructors `errors(spec)` returns. An entry with a `data`
schema makes its constructor require that schema's inferred input; an entry
without one is nullary. Each returns a `TypedResponse<never>` (the serialized
error Response) the handler returns directly.
*/
export type ErrorConstructors<Spec extends ErrorSpec> = {
    [Name in keyof Spec & string]: Spec[Name]['data'] extends StandardSchemaV1
        ? (data: StandardSchemaV1.InferInput<Spec[Name]['data']>) => TypedResponse<never>
        : () => TypedResponse<never>
}
```

Delete `packages/belte/src/lib/shared/types/ErrorConstructors.ts`.

- [ ] **Step 5: Create `ErrorSet.ts`**

Create `packages/belte/src/lib/server/rpc/types/ErrorSet.ts`:

```ts
import type { ErrorSpec } from '../../../shared/types/ErrorSpec.ts'
import type { ERROR_SPEC } from './ERROR_SPEC.ts'
import type { ErrorConstructors } from './ErrorConstructors.ts'

/*
What `errors(spec)` returns: the callable constructor set, branded at the type
level with its `Spec`. The brand drives `Errors` inference at the rpc `errors:`
option, which flows to `RemoteFunction` for client `rpc.isError`. Phantom — never
assigned at runtime; the factory's declared return type is its only home.
*/
export type ErrorSet<Spec extends ErrorSpec> = ErrorConstructors<Spec> & {
    readonly [ERROR_SPEC]?: Spec
}
```

- [ ] **Step 6: Create the `errors()` factory**

Create `packages/belte/src/lib/server/errors.ts`:

```ts
import type { ErrorSpec } from '../shared/types/ErrorSpec.ts'
import { typedErrorResponse } from './runtime/typedErrorResponse.ts'
import type { ErrorSet } from './rpc/types/ErrorSet.ts'

/*
Declares a reusable, typed set of errors for one or more rpcs. Each spec entry
(`{ status, data? }`) becomes a constructor: with a `data` schema it requires that
input, without one it's nullary. A constructor returns the serialized error
`Response` directly (`return orderErrors.invalidCoupon({ code }))`), so no `error()`
wrapper is needed. Pass the same object to the rpc `errors:` option — its declared
type carries the spec so `Errors` infers and the client's `rpc.isError(e, 'name')`
narrows `.kind` / `.data`.
*/
// @readme errors
export function errors<const Spec extends ErrorSpec>(spec: Spec): ErrorSet<Spec> {
    const entries = Object.entries(spec).map(([name, { status }]) => [
        name,
        (data?: unknown) => typedErrorResponse(name, status, data),
    ])
    return Object.fromEntries(entries) as ErrorSet<Spec>
}
```

- [ ] **Step 7: Drop `ctx` from `RemoteHandler`**

Replace `packages/belte/src/lib/server/rpc/types/RemoteHandler.ts` entirely:

```ts
import type { TypedResponse } from './TypedResponse.ts'

/*
A server rpc handler: takes the parsed/validated `args` and returns a
`TypedResponse<Return>` (sync or async). Typed errors are raised by returning a
constructor call from a module-scope `errors(spec)` set — there is no `ctx` param.
*/
export type RemoteHandler<Args, Return> = (
    args: Args,
) => TypedResponse<Return> | Promise<TypedResponse<Return>>
```

- [ ] **Step 8: Update `RpcHelper` — `errors?: ErrorSet<Errors>`, drop handler `Errors` arg**

In `packages/belte/src/lib/server/rpc/types/RpcHelper.ts`: add `import type { ErrorSet } from './ErrorSet.ts'`. In each of the two schema-bearing overloads (the multipart and JSON forms), change the handler type from `RemoteHandler<…, Errors>` to `RemoteHandler<…>` (drop the third arg) and change `errors?: Errors` to `errors?: ErrorSet<Errors>`. Keep `Errors extends ErrorSpec = Record<string, never>` and the `RemoteFunction<…, Errors>` return type. Specifically:

Multipart overload — handler line becomes:
```ts
        fn: RemoteHandler<
            StandardSchemaV1.InferOutput<InputSchema> & StandardSchemaV1.InferOutput<FilesSchema>
        >,
```
and the opts line becomes `errors?: ErrorSet<Errors>`.

JSON overload — handler line becomes:
```ts
        fn: RemoteHandler<StandardSchemaV1.InferOutput<InputSchema>>,
```
and the opts line becomes `errors?: ErrorSet<Errors>`.

Schemaless-with-clients overload (the `<Args, Return, Errors …>` one): change `fn: RemoteHandler<Args, Return, Errors>` to `fn: RemoteHandler<Args, Return>` and `errors?: Errors` to `errors?: ErrorSet<Errors>`. Bare overload (`Rpc(fn)`) is already `RemoteHandler<Args, Return>` — unchanged.

- [ ] **Step 9: Strip ctx construction from `defineRpc`**

In `packages/belte/src/lib/server/rpc/defineRpc.ts`:
- Remove `import { buildErrorConstructors } from './buildErrorConstructors.ts'`.
- Remove the line `const errors = buildErrorConstructors(opts?.errors ?? {})` (and its comment).
- Change the handler invocation `() => handler(args as Args, { errors }) as unknown as Response` to `() => handler(args as Args) as unknown as Response`.
- Leave `opts.errors?: ErrorSpec` as-is (a runtime no-op type carrier); `defineRpc`'s return type `RemoteFunction<Args, Return>` is unchanged — the typed `Errors` surface lives on the `RpcHelper`-typed `GET`/`POST` exports, not the plumbing `defineRpc`.

- [ ] **Step 10: Delete `buildErrorConstructors.ts`**

```bash
rm packages/belte/src/lib/server/rpc/buildErrorConstructors.ts
```

- [ ] **Step 11: Run tests + typecheck**

Run: `cd packages/belte && bun test tests/errors.test.ts tests/rpcTypedErrors.test.ts`
Expected: PASS (factory units + migrated wire/status/`isError` assertions).
Run: `cd packages/belte && bun test 2>&1 | tail -20`
Expected: full suite green.
Run: `cd /Users/briancray/Code/belte && bun run typecheck 2>&1 | tail -30`
Expected: clean — the `_inferenceCheck` function compiles (no cast, `.data.available` typed as `number`).

- [ ] **Step 12: Format + commit**

```bash
cd /Users/briancray/Code/belte
bun format packages/belte/src/lib/server/errors.ts packages/belte/src/lib/server/rpc/types/ERROR_SPEC.ts packages/belte/src/lib/server/rpc/types/ErrorSet.ts packages/belte/src/lib/server/rpc/types/ErrorConstructors.ts packages/belte/src/lib/server/rpc/types/RemoteHandler.ts packages/belte/src/lib/server/rpc/types/RpcHelper.ts packages/belte/src/lib/server/rpc/defineRpc.ts packages/belte/tests/errors.test.ts packages/belte/tests/rpcTypedErrors.test.ts
git add -A
git commit -m "feat(belte): errors() factory replaces ctx.errors; constructors return TypedResponse"
```

---

### Task 3: Remove descriptor remnants

With the factory producing Responses and `validationError` using the serializer, nothing produces or consumes `ErrorDescriptor`. Remove the dead `error(descriptor)` overload and the type.

**Files:**
- Modify: `packages/belte/src/lib/server/error.ts`
- Delete: `packages/belte/src/lib/shared/types/ErrorDescriptor.ts`

**Interfaces:**
- Changes: `error()` becomes single-signature `error(status: number, message?: string, init?: ResponseInit): TypedResponse<never>`.

- [ ] **Step 1: Confirm there are no remaining descriptor producers/consumers**

Run: `cd /Users/briancray/Code/belte && grep -rn "ErrorDescriptor\|error({" packages/belte/src packages/belte/tests`
Expected: only `error.ts` (its overload + branch + import) and `ErrorDescriptor.ts` itself. No other hits. If anything else appears, stop and reconcile before deleting.

- [ ] **Step 2: Remove the descriptor overload + branch from `error.ts`**

In `packages/belte/src/lib/server/error.ts`:
- Remove `import type { ErrorDescriptor } from '../shared/types/ErrorDescriptor.ts'`.
- Remove the import of `typedErrorResponse` (no longer used here once the branch is gone): `import { typedErrorResponse } from './runtime/typedErrorResponse.ts'`.
- Remove the overload line `export function error(descriptor: ErrorDescriptor): TypedResponse<never>`.
- Change the implementation signature from `statusOrDescriptor: number | ErrorDescriptor, message?, init?` to `status: number, message?: string, init?: ResponseInit`.
- Remove the entire `if (typeof statusOrDescriptor === 'object') { … }` branch.
- The body becomes only the ad-hoc plain-text path (keep the `STATUS_TEXT` import for the default message). Resulting function:

```ts
// @readme response
export function error(status: number, message?: string, init?: ResponseInit): TypedResponse<never> {
    const body = message ?? STATUS_TEXT[status] ?? `HTTP ${status}`
    return new Response(
        body,
        withResponseDefaults(
            init,
            { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': NO_STORE },
            status,
        ),
    ) as TypedResponse<never>
}
```

Update the leading doc comment of `error()` to drop any mention of the descriptor form (it already documents the ad-hoc form; remove the descriptor sentence if present).

- [ ] **Step 3: Delete `ErrorDescriptor.ts`**

```bash
rm packages/belte/src/lib/shared/types/ErrorDescriptor.ts
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd packages/belte && bun test 2>&1 | tail -20`
Expected: full suite green.
Run: `cd /Users/briancray/Code/belte && bun run typecheck 2>&1 | tail -20`
Expected: clean.

- [ ] **Step 5: Format + commit**

```bash
cd /Users/briancray/Code/belte
bun format packages/belte/src/lib/server/error.ts
git add -A
git commit -m "refactor(belte): drop dead error(descriptor) overload + ErrorDescriptor"
```

---

### Task 4: Exports, README, examples

Publish `belte/server/errors`, document it in its own README section, and migrate examples + the scaffold template to the new form.

**Files:**
- Modify: `packages/belte/package.json` (`exports` map)
- Modify: `README.md` (via `write-readme` skill)
- Modify: examples + `packages/belte/scripts` scaffold template (via `sync-examples` skill)

**Interfaces:**
- Produces: public import path `belte/server/errors` exporting `errors`.

- [ ] **Step 1: Add the `exports` entry with its `@readme` tag**

In `packages/belte/package.json`, add an entry to the `exports` map for `./server/errors` pointing at the built `errors` module, mirroring the shape of the existing `./server/error` entry (same conditions/paths, adjusted filename). Directly above it add the comment line `// @readme errors`. Match the surrounding entries' formatting exactly.

- [ ] **Step 2: Verify the surface is tagged and discoverable**

Run: `cd /Users/briancray/Code/belte && bun run packages/belte/scripts/readmeSurfaces.ts 2>&1 | grep -i "errors"`
Expected: lists `errors` under slug `errors` with no "untagged export" warning for it.

- [ ] **Step 3: Regenerate the README via the write-readme skill**

Invoke the `write-readme` skill. Ensure the output contains a dedicated `## errors` section showing the factory + a handler returning a constructor call, and that `error()` stays in its response-helpers section. Confirm no stale `ctx.errors` / `error(errors.x())` snippets remain.

Run (sanity): `cd /Users/briancray/Code/belte && grep -n "ctx.errors\|error(errors\." README.md`
Expected: no matches.

- [ ] **Step 4: Migrate examples + scaffold via the sync-examples skill**

Invoke the `sync-examples` skill. Any example or the bundled scaffold template that declares typed errors must move from `(args, { errors }) => error(errors.x(d))` to a module-scope `errors(spec)` set + `(args) => set.x(d)`, importing from `belte/server/errors`.

Run: `cd /Users/briancray/Code/belte && grep -rn "ctx.errors\|{ errors }" examples packages/belte/scripts --include=*.ts --include=*.svelte | grep -v dist`
Expected: no matches (excluding built `dist/` bundles).

- [ ] **Step 5: Full verification**

Run: `cd /Users/briancray/Code/belte && bun run typecheck 2>&1 | tail -20`
Expected: clean.
Run: `cd packages/belte && bun test 2>&1 | tail -20`
Expected: full suite green.

- [ ] **Step 6: Add a changeset + commit**

Add a changeset describing the new `belte/server/errors` surface and the `ctx.errors` removal (breaking), matching the repo's existing changeset style under `.changeset/`.

```bash
cd /Users/briancray/Code/belte
bun format packages/belte/package.json
git add -A
git commit -m "feat(belte): export belte/server/errors; document + migrate examples"
```

---

## Self-Review

**Spec coverage:**
- `errors()` factory in `belte/server/errors` → Task 2 (factory) + Task 4 (export).
- Constructors return `TypedResponse<never>` → Task 2 Step 4/6.
- Type-level brand `ErrorSet`/`ERROR_SPEC`, `Errors` inference flow → Task 2 Steps 3/5/8 + `_inferenceCheck` (Step 1/11).
- Drop `ctx.errors` (decision B) → Task 2 Steps 7/9.
- `typedErrorResponse` shared by factory + `validationError` → Task 1.
- Remove `error(descriptor)` overload + `ErrorDescriptor` → Task 3.
- `## errors` README section → Task 4 Step 3.
- Migration of `rpcTypedErrors.test.ts` + examples → Task 2 Step 1, Task 4 Step 4.
- Wire/status/`isError` unchanged → asserted by the preserved assertions in Task 2 Step 1.
- Server-side placement of `ErrorConstructors`/`ErrorSet`/`ERROR_SPEC` (layering) → Task 2 Steps 3–5.

**Placeholder scan:** none — every code step shows complete content; the two skill-driven steps (write-readme, sync-examples) are bounded by explicit grep post-conditions.

**Type consistency:** `errors`, `ErrorSet<Spec>`, `ErrorConstructors<Spec>`, `ERROR_SPEC`, `typedErrorResponse(name, status, data)`, `RemoteHandler<Args, Return>`, `errors?: ErrorSet<Errors>` used identically across tasks. `error(status, message?, init?)` final signature matches Task 1's preserved ad-hoc path.
