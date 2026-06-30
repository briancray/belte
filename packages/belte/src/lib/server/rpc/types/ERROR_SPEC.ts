/*
Type-level brand key on `ErrorSet`, carrying the declared `ErrorSpec` so `Errors`
infers off the rpc `errors:` option (TS can't reverse a mapped `ErrorConstructors`
back to its `Spec` without a direct `Spec` position). Declared, never assigned —
emits no runtime value and is used only in type positions.
*/
export declare const ERROR_SPEC: unique symbol
