import { GET } from 'belte/rpc'

export const boom = GET<undefined, never>(() => {
    throw new Error('intentional boom — demonstrating the 500 error path')
})
