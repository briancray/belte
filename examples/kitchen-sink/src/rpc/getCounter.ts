import { GET } from 'belte/rpc'
import { counterState } from '../counterState.ts'

export const getCounter = GET<undefined, { count: number }>(() =>
    Response.json({ count: counterState.count }),
)
