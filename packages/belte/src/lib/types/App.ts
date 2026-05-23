/*
Augmentable app-level types. Defaults are empty/permissive shapes — augment
from src/app.ts via `declare module` to give framework types concrete
payloads. Interfaces declared in this module merge with any user-side
augmentation, so `declare module 'belte/types/App'` is the only step needed.

    declare module 'belte/types/App' {
        interface SocketData {
            userId: string
        }
    }

The augmented SocketData flows through AppModule, Server, ServerWebSocket,
and the request-scoped RequestStore.
*/
export interface SocketData {}
