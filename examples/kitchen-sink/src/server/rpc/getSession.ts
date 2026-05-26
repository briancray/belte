import { json } from 'belte/server/json'
import { GET } from 'belte/server/GET'
import { getSession as readSession, readSessionCookie } from '../../sessions.ts'

export const getSession = GET(() => {
    const session: { user: string } | null = readSession(readSessionCookie()) ?? null
    return json(session)
})
