import { GET } from 'belte/rpc'
import { getSession as readSession, readSessionCookie } from '../sessions.ts'

export const getSession = GET<undefined, { user: string } | null>(() => {
    const session = readSession(readSessionCookie()) ?? null
    return Response.json(session)
})
