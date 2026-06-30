# Typed-error ergonomics: module-scope `errors()` + direct-return constructors

Date: 2026-06-30
Status: approved, pending implementation plan

## Problem

Declaring and raising a typed error inside an RPC handler today carries two
frictions:

1. **Second-arg ceremony.** A handler that raises a declared error must take a
   `ctx` second parameter and reach into `ctx.errors`:
   ```ts
   POST((args, { errors }) => error(errors.invalidCoupon({ code: 'EXPIRED' })), {
     inputSchema, errors: { invalidCoupon: { status: 400, data: couponSchema } },
   })
   ```
   `ctx.errors` is inferred and typed through `GET`/`POST` (the `RpcHelper`
   `Errors` generic threads `opts.errors` into the handler), so no cast is
   needed there — the `ctx.errors as ErrorConstructors<…>` cast in
   `rpcTypedErrors.test.ts:42` is only an artifact of the low-level `defineRpc`
   primitive, which carries no `Errors` generic.

2. **Double-call.** Constructors return an inert `ErrorDescriptor` that is only
   ever handed straight to `error()` — `error(errors.x(data))`. Nothing else
   produces or consumes descriptors except `validationError`.

`opts.errors` is consumed at exactly one runtime site — `defineRpc.ts:84`,
`buildErrorConstructors(opts?.errors ?? {})` — purely to build the ctx
constructors. The spec is **not** advertised in OpenAPI/MCP. So the spec has no
runtime reader beyond ctx construction, and the `Errors` generic on
`RemoteFunction` (for client `rpc.isError`) is the only thing that must survive.

## Goals

- One blessed way to declare and raise a typed error.
- Remove the `error(descriptor)` indirection: a constructor call *is* the
  returned response.
- Keep client `rpc.isError(e, 'name')` typing exactly as today.
- Shrink the surface (`ErrorDescriptor` and `error`'s descriptor overload go
  away), consistent with "small surface, minimal magic, high visibility."

## Decisions (resolved during brainstorming)

- **B — replace `ctx.errors` entirely.** The handler loses its second `ctx`
  param. Declared errors are reachable only via a module-scope set the handler
  closes over.
- **A — one object, type-level brand.** `errors(spec)` returns the callable
  constructor set; the same object is passed to `errors:`. The spec rides as a
  *type-level phantom brand* on the factory's declared return type — no runtime
  symbol is attached, because nothing reads the spec at runtime. The runtime
  value is plain inspectable functions.
- **Name/namespace — `errors` in `belte/server/errors`.** Pairs with the
  existing `error()` (ad-hoc single) and matches the `errors:` option key. Lands
  in `server/` because its constructors build a `TypedResponse` (a server
  concern); only the `Errors` *type* crosses to the client.
- **Full removal of the descriptor machinery (#1).** Extract the JSON-error
  serializer; delete `ErrorDescriptor` and `error`'s descriptor overload.
- **README — its own `## errors` section.**

## Design

### Public API — `belte/server/errors`

```ts
import { errors } from 'belte/server/errors'

const orderErrors = errors({
  invalidCoupon: { status: 400, data: couponSchema },
  outOfStock:    { status: 409, data: stockSchema },
  cartEmpty:     { status: 409 },                      // nullary (no data schema)
})

export const buy = POST(
  (args) => {
    if (!stock(args.sku)) return orderErrors.outOfStock({ available: 0 })
    return json({ ok: true })
  },
  { inputSchema, errors: orderErrors },
)
```

- `errors(spec)` returns a callable set: one constructor per declared name.
- A constructor with a `data` schema requires that schema's input; a nullary
  one (no `data`) takes no args. Each returns `TypedResponse<never>`.
- The same object is passed to `errors:`. Its declared type `ErrorSet<Spec>`
  carries `Spec` as a phantom brand, so `Errors` infers off `opts.errors` and
  flows into `RemoteFunction<Args, Return, Errors>` → client
  `rpc.isError(e, 'name')` narrows `.kind`/`.data` exactly as before.

Wire format, status, `statusText`, client `HttpError.kind`/`.data`, and
`rpc.isError` overloads (declared names + reserved `validation` + `queued`) are
**unchanged**.

### Type changes

- **`ErrorConstructors<Spec>`** — each constructor returns
  `TypedResponse<never>` instead of `ErrorDescriptor<Name, Data>`.
- **New `ErrorSet<Spec>`** (`lib/server/rpc/types/ErrorSet.ts`) =
  `ErrorConstructors<Spec>` branded with `Spec` at the type level:
  ```ts
  export type ErrorSet<Spec extends ErrorSpec> = ErrorConstructors<Spec> & {
    /* Phantom: carries Spec for `Errors` inference at the `errors:` opt.
       Never assigned at runtime — the factory's declared return type is the
       only place it lives. */
    readonly [ERROR_SPEC]?: Spec
  }
  ```
  `ERROR_SPEC` is a `unique symbol` constant
  (`lib/server/rpc/types/ERROR_SPEC.ts`, UPPERCASE per repo convention) used
  only as a type key.

  `ErrorConstructors`, `ErrorSet`, and `ERROR_SPEC` live under `server/` (not
  `shared/`): `ErrorConstructors` now references the server-only `TypedResponse`,
  and after `ctx` is dropped no shared/client code references them. The client's
  `rpc.isError` typing uses `ErrorSpec` + `DeclaredErrorData`, which stay in
  `shared/`.
- **`RemoteHandler<Args, Return>`** — drops the third `Errors` generic and the
  `ctx` param. Signature becomes
  `(args: Args) => TypedResponse<Return> | Promise<TypedResponse<Return>>`.
- **`RpcHelper`** — every schema-bearing overload's `errors?: Errors` becomes
  `errors?: ErrorSet<Errors>` (with `Errors extends ErrorSpec` inferred from it).
  `RemoteFunction<…, Errors>` return type unchanged. The handler param type drops
  its `Errors` argument.
- **`defineRpc`** — `opts.errors?: ErrorSet<ErrorSpec>` (type carrier only).
  Deletes the `buildErrorConstructors` import + call + the `{ errors }` second
  arg at the `handler(args, …)` invocation. `outbox`/timeout/validation paths
  unchanged.

### Internal serializer — `typedErrorResponse`

Extract `error.ts` lines 73–85 (the descriptor branch) plus `STATUS_TEXT` into
`lib/server/runtime/typedErrorResponse.ts`:

```ts
// Serializes a typed error as `{ $belteError, data }` JSON at `status`,
// with the status reason phrase as statusText (read back by httpErrorFor).
export function typedErrorResponse(
  name: string, status: number, data: unknown,
): TypedResponse<never>
```

Consumers:
- the factory's constructors (each closes over its name + status),
- `validationError` (replaces its `error({ $belteError: 'validation', … })`
  call).

`STATUS_TEXT` moves alongside the serializer; `error.ts` imports it back for the
ad-hoc plain-text path.

### `error()` after #1

Reverts to a single job — ad-hoc plain-text:
```ts
export function error(status: number, message?: string, init?: ResponseInit): TypedResponse<never>
```
The `error(descriptor)` overload and the `ErrorDescriptor` import/branch are
removed.

## Files

**New**
- `lib/server/errors.ts` — the `errors()` factory.
- `lib/server/runtime/typedErrorResponse.ts` — JSON-error serializer.
- `lib/server/runtime/STATUS_TEXT.ts` — status reason-phrase map (moved out of `error.ts`).
- `lib/server/rpc/types/ErrorSet.ts` — `ErrorSet<Spec>`.
- `lib/server/rpc/types/ERROR_SPEC.ts` — `unique symbol` brand key.

**Edit**
- `lib/server/error.ts` — drop descriptor overload/branch; import `STATUS_TEXT`.
- `lib/shared/types/ErrorConstructors.ts` → moves to `lib/server/rpc/types/ErrorConstructors.ts`; returns `TypedResponse<never>`.
- `lib/server/rpc/types/RemoteHandler.ts` — drop `Errors` + `ctx`.
- `lib/server/rpc/types/RpcHelper.ts` — `errors?: ErrorSet<Errors>`.
- `lib/server/rpc/defineRpc.ts` — remove ctx construction.
- `lib/server/rpc/validationError.ts` — use `typedErrorResponse`.
- `package.json` exports — add `belte/server/errors` with a `// @readme errors` tag.
- README — new `## errors` section (run `write-readme`).
- examples + scaffold template — migrate via `sync-examples`.

**Delete**
- `lib/shared/types/ErrorDescriptor.ts`
- `lib/server/rpc/buildErrorConstructors.ts`

## Migration

Existing `(args, { errors }) => error(errors.x(d))` handlers rewrite to a
module-scope `const set = errors({...})` + `(args) => set.x(d)`. The cases in
`rpcTypedErrors.test.ts` become the migrated conformance examples; assertions on
wire shape / status / `isError` narrowing stay identical.

## Testing

- `rpcTypedErrors.test.ts` rewritten to the new form; same wire/status/narrowing
  assertions (these are the behavioral contract and must not change).
- New unit coverage: nullary constructor (no `data`), `errors:` opt inference
  driving `rpc.isError` types, `typedErrorResponse` output shape shared by the
  factory and `validationError`.
- `bun run typecheck` (tsgo) clean; consumer strict-typecheck guard clean.
- `bun format` on every touched file.

## Out of scope (YAGNI)

- Advertising declared errors in OpenAPI/MCP. The phantom brand leaves the door
  open (attach the real spec under `ERROR_SPEC` if a future doc pass needs it),
  but nothing reads it today.
- Throwable error constructors (`throw set.x(d)`) — return-style stays the one
  control-flow shape, matching `json`/`redirect`.
