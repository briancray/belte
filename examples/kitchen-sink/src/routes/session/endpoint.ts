import { GET } from 'belte/route/GET'
import { getSession as readSession, readSessionCookie } from '../../sessions.ts'

export const getSession = GET<undefined, { user: string } | null>((_args, req) => {
    const session = readSession(readSessionCookie(req)) ?? null
    return Response.json(session)
})
