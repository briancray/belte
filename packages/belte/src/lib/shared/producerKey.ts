import { canonicalJson } from './canonicalJson.ts'

/*
Producers have no wire identity, so each is assigned a stable id on first use,
kept in a WeakMap so it's collected with the function. The cache key is that id
plus the canonicalised args — a hoisted producer dedupes across calls; an inline
arrow gets a fresh id every call and never does.

`producerKey.existing` reads the id without assigning one — selectors matching
prior entries must not mint identities for producers never cached.
*/
const producerIds = new WeakMap<object, string>()
let producerCounter = 0

export function producerKey(producer: object, args: unknown): string {
    /* Not getOrInsertComputed: shared module ships to the browser, where support is too new (Safari 26.2 / Chrome 145). */
    let id = producerIds.get(producer)
    if (id === undefined) {
        id = `@producer:${++producerCounter}`
        producerIds.set(producer, id)
    }
    return args === undefined ? id : `${id} ${canonicalJson(args)}`
}

/* With `args`, the exact entry key for that call (same format as producerKey) — still never minting. */
producerKey.existing = function existing(producer: object, args?: unknown): string | undefined {
    const id = producerIds.get(producer)
    if (id === undefined || args === undefined) {
        return id
    }
    return `${id} ${canonicalJson(args)}`
}

/*
The human label for traces and the inspector: `key` with the minted id swapped
for the producer's function name (`searchLdap {args}` in place of
`@producer:2 {args}`). The id stays the key — names aren't unique, so they can't
key — this only re-skins it for display. Undefined for an anonymous producer
(no name to show); callers fall back to the key, which is its only identity.
*/
producerKey.label = function label(producer: object, key: string): string | undefined {
    const name = (producer as { name?: string }).name
    const id = producerIds.get(producer)
    if (!name || id === undefined) {
        return undefined
    }
    return name + key.slice(id.length)
}
