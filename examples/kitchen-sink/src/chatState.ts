import type { ChatMessage } from '$server/sockets/chat.ts'

/*
Module-level state stands in for a database for the chat demos. `published`
is a running total; `recent` keeps the last messages published. The cache
page binds cache.on(chat, …) against this state two ways: getChatCount reads
`published` and is invalidated (dropped, then refetched) per frame, while
getChatLog reads `recent` and is patched — the frame's own payload folded
into the cached value with no refetch.
*/
const RECENT_LIMIT = 20

export const chatState: { published: number; recent: ChatMessage[] } = {
    published: 0,
    recent: [],
}

/* Record a published message before it fans out, so a cache.on invalidate refetch reads it. */
export function recordChat(message: ChatMessage): void {
    chatState.published += 1
    chatState.recent = [...chatState.recent, message].slice(-RECENT_LIMIT)
}
