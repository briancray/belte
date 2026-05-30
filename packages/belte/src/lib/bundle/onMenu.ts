/*
Subscribes to bundle menu clicks. Each custom menu item declared in the bundle
window config dispatches a `belte:menu` CustomEvent into the page when clicked;
this registers `handler`, called with the item's `emit` name. Returns an
unsubscribe function, so it drops straight into a Svelte `$effect`:

    $effect(() =>
        onMenu((name) => {
            if (name === 'reload') location.reload()
        }),
    )

Inert during SSR and in a plain browser tab — `$effect` only runs client-side,
the native menu that fires the event exists only in the bundled desktop app,
and `window` is guarded so importing the module never assumes a DOM.
*/
export function onMenu(handler: (name: string) => void): () => void {
    if (typeof window === 'undefined') {
        return () => {}
    }
    function listener(event: Event) {
        handler((event as CustomEvent<{ name: string }>).detail.name)
    }
    window.addEventListener('belte:menu', listener)
    return () => window.removeEventListener('belte:menu', listener)
}
