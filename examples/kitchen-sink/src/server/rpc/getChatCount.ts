import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { chatState } from '../../chatState.ts'

/*
A read the chat socket's frames make stale — the cache page binds
cache.on(chat, …) to invalidate it on every message, so cached copies
refetch without any hand-rolled $effect plumbing.
*/
export const getChatCount = GET(() => json({ published: chatState.published }))
