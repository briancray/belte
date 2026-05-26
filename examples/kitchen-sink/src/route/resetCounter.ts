import { json } from 'belte/respond'
import { DELETE } from 'belte/route'
import { counterState } from '../counterState.ts'

export const resetCounter = DELETE<undefined, { count: number }>(() => {
    counterState.count = 0
    return json({ count: counterState.count })
})
