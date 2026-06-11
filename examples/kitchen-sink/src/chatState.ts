/*
Module-level state stands in for a database for the chat demos: a running
total of messages published through publishChat. getChatCount reads it; the
cache page's cache.on binding invalidates that read on every chat frame.
*/
export const chatState = { published: 0 }
