---
"@belte/belte": minor
---

Add `belte/server/errors` — a module-scope `errors(spec)` factory that declares a reusable, typed set of failures. Each `{ status, data? }` entry becomes a constructor returning the serialized error response directly (`return orderErrors.invalidCoupon({ code })`), and passing the same set to the rpc `errors:` option lets the client's `rpc.isError(caught, 'name')` narrow `.kind` and typed `.data`.

BREAKING: the handler `ctx.errors` second-arg form is removed. Handlers that wrote `(args, { errors }) => error(errors.x(d))` must declare an `errors(spec)` set at module scope and return its constructor: `(args) => set.x(d)`. `error()` is now ad-hoc plain-text only — `error(status, message?, init?)`; the `error(descriptor)` overload is gone.
