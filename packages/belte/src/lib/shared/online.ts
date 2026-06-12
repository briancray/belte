import { createSubscriber } from 'svelte/reactivity'

/*
Reactive network-connectivity probe in the pending()/refreshing() family:
reading it from a $derived/$effect re-runs that scope when the browser's
online/offline events fire. navigator.onLine's *offline* signal is reliable
(a true network loss always reports); its online value can false-positive
behind captive portals — verified backend reachability is a separate,
opt-in concern (the bundle launcher's liveness watch owns it for bundles).
Constant true on the server: the server is its own backend. Reports, never
acts — reading this opens no fetch and no stream.
*/
const subscribeOnline =
    typeof window === 'undefined'
        ? undefined
        : createSubscriber((update) => {
              const changed = () => update()
              window.addEventListener('online', changed)
              window.addEventListener('offline', changed)
              return () => {
                  window.removeEventListener('online', changed)
                  window.removeEventListener('offline', changed)
              }
          })

export function online(): boolean {
    /* window, not navigator: Bun defines a partial navigator with no onLine. */
    if (typeof window === 'undefined') {
        return true
    }
    subscribeOnline?.()
    return navigator.onLine
}
