import { DELETE } from 'belte/rpc'
import { counterState } from '../counterState.ts'

export const resetCounter = DELETE<undefined, { count: number }>(() => {
    counterState.count = 0
    return Response.json({ count: counterState.count })
})
