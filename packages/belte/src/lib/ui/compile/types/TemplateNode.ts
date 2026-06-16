import type { TemplateAttr } from './TemplateAttr.ts'
import type { TextPart } from './TextPart.ts'

/*
A parsed template node. `text` carries interpolation parts; `element` carries
attributes and children; `each` is the `<template each as key>` control flow over
a list. (if/await/switch are future siblings.)
*/
export type TemplateNode =
    | { kind: 'text'; parts: TextPart[] }
    | { kind: 'script'; code: string }
    | { kind: 'element'; tag: string; attrs: TemplateAttr[]; children: TemplateNode[] }
    | { kind: 'each'; items: string; as: string; key: string | undefined; children: TemplateNode[] }
    | { kind: 'if'; condition: string; children: TemplateNode[] }
    | {
          kind: 'await'
          promise: string
          /* `then` riding the `await` tag (`<template await={p} then={v}>`) makes the
             block BLOCKING: no pending branch, children are the resolved content bound
             to `as`, SSR settles before the first flush. Absent → streaming. */
          blocking: boolean
          as: string | undefined
          children: TemplateNode[]
      }
    | { kind: 'try'; children: TemplateNode[] }
    | {
          kind: 'branch'
          branch: 'then' | 'catch' | 'finally'
          as: string | undefined
          children: TemplateNode[]
      }
    | {
          kind: 'component'
          name: string
          props: { name: string; code: string }[]
          children: TemplateNode[]
      }
    | { kind: 'switch'; subject: string; children: TemplateNode[] }
    | { kind: 'case'; match: string | undefined; children: TemplateNode[] }
    /* A `<template name="row" args={item}>` snippet: a named, scope-capturing
       builder declared once and called like a function (`{row(item)}`). `params`
       is the raw `args` source spliced into the builder's parameter list. */
    | { kind: 'snippet'; name: string; params: string | undefined; children: TemplateNode[] }
