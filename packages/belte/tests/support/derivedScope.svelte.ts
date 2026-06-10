/*
Like reactiveScope's track(), but routes the read through a $derived so it
evaluates in derived context — where Svelte forbids state writes
(state_unsafe_mutation). Exercises consumers whose read path must stay
write-free: `$derived(await cache(fn)())` is the documented idiom, so a cold
read that mutates subscriber state would throw exactly here. Compiled via the
Svelte module loader in sveltePreload.ts.
*/
export function trackDerived<T>(read: () => T): { current: () => T | undefined; stop: () => void } {
    let value: T | undefined
    const stop = $effect.root(() => {
        const derivedValue = $derived.by(read)
        $effect(() => {
            value = derivedValue
        })
    })
    return { current: () => value, stop }
}
