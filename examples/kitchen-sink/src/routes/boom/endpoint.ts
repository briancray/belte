import { GET } from 'belte/route/GET'

export const boom = GET<undefined, never>(() => {
    throw new Error('intentional boom — demonstrating the 500 error path')
})
