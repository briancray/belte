import { POST } from 'belte/rpc'
import { counterState } from '../counterState.ts'

export const incrementCounter = POST<undefined, { count: number }>(() => {
    counterState.count += 1
    return Response.json({ count: counterState.count })
})
