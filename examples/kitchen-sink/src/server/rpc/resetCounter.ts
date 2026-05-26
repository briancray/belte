import { json } from 'belte/server/json'
import { DELETE } from 'belte/server/DELETE'
import { counterState } from '../../counterState.ts'

export const resetCounter = DELETE(() => {
    counterState.count = 0
    return json({ count: counterState.count })
})
