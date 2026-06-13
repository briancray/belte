import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { chatState } from '../../chatState.ts'

/*
A read whose fresh value the chat socket's frames already carry — the cache
page binds cache.on(chat, (message, { patch }) => patch(getChatLog, …)) to
fold each frame into the cached list with no refetch. The authoritative-
broadcast path: the frame is the new message, so appending it to the cached
value locally is correct, where getChatCount instead refetches a derived total.
*/
export const getChatLog = GET(() => json({ messages: chatState.recent }))
