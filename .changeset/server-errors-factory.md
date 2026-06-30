---
"@belte/belte": minor
---

Add `error.typed(name, status, schema?)` — declare a single, reusable typed-error constructor. Returning it from a handler IS the error (it serializes a `{ $belteError, data }` body at `status`), and the rpc reads the constructor's branded return type to expose the error on the client's `rpc.isError(caught, 'name')` (narrowing `.kind` and typed `.data`). Compose by returning whichever constructors you want — no set, no registration:

```ts
const outOfStock = error.typed('outOfStock', 409, z.object({ sku: z.string() }))
export const buy = POST(({ sku }) => (inStock(sku) ? json(place(sku)) : outOfStock({ sku })))
// buy.isError(e, 'outOfStock') → e.data: { sku: string }, inferred from the body
```

The rpc's typed-error surface is now **inferred from the handler's return type** — the errors a handler returns are the errors it can raise — so there is no `errors:` rpc option and no `errors(spec)` factory. A typed error you only ever `throw` (rather than `return`) narrows kind-only, like a plain `error()`.

BREAKING: removes the never-released `belte/server/errors` export and the rpc `errors:` option. Replace `errors({ x: { status, data } })` + `errors: set` with module-scope `const x = error.typed('x', status, schema)` constructors returned from the handler.
