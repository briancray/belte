import { afterEach, describe, expect, test } from 'bun:test'
import { createViewResolver } from '../src/lib/shared/createViewResolver.ts'
import { logTapSlot } from '../src/lib/shared/logTapSlot.ts'
import type { LogRecord } from '../src/lib/shared/types/LogRecord.ts'

const savedDebug = process.env.DEBUG

afterEach(() => {
    logTapSlot.tap = undefined
    if (savedDebug === undefined) {
        delete process.env.DEBUG
    } else {
        process.env.DEBUG = savedDebug
    }
})

/* A view resolver over one fake page module — exercises the real belte:view
   instrumentation without booting an app. */
const resolverWithRoute = (route: string) =>
    createViewResolver({
        pages: { [route]: async () => ({ default: (() => undefined) as never }) },
    })

describe('internal framework spans', () => {
    test('view resolution emits a belte:view span (name + duration) when the channel is on', async () => {
        process.env.DEBUG = 'belte:view'
        const records: LogRecord[] = []
        logTapSlot.tap = (record) => records.push(record)

        await resolverWithRoute('/x').view('/x')

        const span = records.find((record) => record.name === 'view /x')
        expect(span).toBeDefined()
        expect(span!.channel).toBe('belte:view')
        expect(typeof span!.durationMs).toBe('number')
    })

    test('no span emitted when the channel is off — gated, zero-cost by default', async () => {
        process.env.DEBUG = ''
        const records: LogRecord[] = []
        logTapSlot.tap = (record) => records.push(record)

        await resolverWithRoute('/y').view('/y')

        expect(records.some((record) => record.name === 'view /y')).toBe(false)
    })
})
