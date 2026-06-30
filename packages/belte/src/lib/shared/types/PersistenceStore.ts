/*
The durable backend the outbox queue writes to. Deliberately tiny and synchronous —
`load` must return the saved value in time to seed the queue before first read, which a
sync store (localStorage) gives for free. Inject a custom one for a different backend (a
test memory store; a server data-dir store); an async backend (IndexedDB) needs an
async-boot wrapper, out of this contract.
*/
export type PersistenceStore = {
    load: (key: string) => unknown
    save: (key: string, snapshot: unknown) => void
    remove: (key: string) => void
}
