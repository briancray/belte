import { json } from 'belte/server/json'
import { GET } from 'belte/server/GET'
import { counterState } from '../../counterState.ts'

export const getCounter = GET(() => json({ count: counterState.count }))
