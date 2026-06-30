import type { PersistenceStore } from '../../shared/types/PersistenceStore.ts'

/*
The default outbox persistence backend: `localStorage` keyed by the queue's persistence
key, plain JSON on the wire. Plain JSON is sufficient because a `StoredEntry` is already
wire-shaped — id, args (the JSON request args), method, url, body string, content type,
status. Returns `undefined` where there is no `localStorage` (the server, or a browser
with storage disabled), which the queue reads as "stay inert". A corrupt or unreadable
entry loads as `undefined` rather than throwing, so one bad write can't wedge boot; the
next save rewrites it.
*/
export function localStoragePersistence(): PersistenceStore | undefined {
    if (typeof localStorage === 'undefined') {
        return undefined
    }
    return {
        load: (key) => {
            const raw = localStorage.getItem(key)
            if (raw === null) {
                return undefined
            }
            try {
                return JSON.parse(raw)
            } catch {
                return undefined
            }
        },
        save: (key, snapshot) => {
            /* Swallow a failed write (QuotaExceededError, storage disabled mid-session) —
               a dropped persist must not crash the app. */
            try {
                localStorage.setItem(key, JSON.stringify(snapshot))
            } catch {
                // best-effort persistence
            }
        },
        remove: (key) => {
            localStorage.removeItem(key)
        },
    }
}
