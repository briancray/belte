import { describe, expect, test } from 'bun:test'
import type { Component } from 'svelte'
import { createViewResolver } from '../src/lib/shared/createViewResolver.ts'

/* Distinct component stand-ins so assertions can check identity, not just shape. */
const components = {
    home: (() => {}) as unknown as Component,
    admin: (() => {}) as unknown as Component,
    deep: (() => {}) as unknown as Component,
    rootLayout: (() => {}) as unknown as Component,
    adminLayout: (() => {}) as unknown as Component,
    rootError: (() => {}) as unknown as Component,
}

const loader = (component: Component) => async () => ({ default: component })

const pages = {
    '/': loader(components.home),
    '/admin': loader(components.admin),
    '/admin/deep/[id]': loader(components.deep),
}

const layouts = {
    '/': loader(components.rootLayout),
    '/admin': loader(components.adminLayout),
}

const errors = {
    '/': loader(components.rootError),
}

describe('createViewResolver', () => {
    const resolver = createViewResolver({ pages, layouts, errors })

    test('resolves a route to its page inside the root layout', async () => {
        const view = await resolver.view('/')
        expect(view.Page).toBe(components.home)
        expect(view.Layout).toBe(components.rootLayout)
    })

    test('the deepest ancestor layout wins — no stacking', async () => {
        const view = await resolver.view('/admin/deep/[id]')
        expect(view.Page).toBe(components.deep)
        expect(view.Layout).toBe(components.adminLayout)
    })

    test('no layouts bound resolves Layout to undefined', async () => {
        const bare = createViewResolver({ pages })
        const view = await bare.view('/admin')
        expect(view.Page).toBe(components.admin)
        expect(view.Layout).toBeUndefined()
    })

    test('an unknown route rejects', () => {
        expect(resolver.view('/nope')).rejects.toThrow('unknown route')
    })

    test('has() answers route membership', () => {
        expect(resolver.has('/admin')).toBe(true)
        expect(resolver.has('/nope')).toBe(false)
    })

    test('error() resolves the nearest error view inside the pathname-nearest layout', async () => {
        const view = await resolver.error('/admin/whatever')
        expect(view?.Page).toBe(components.rootError)
        expect(view?.Layout).toBe(components.adminLayout)
    })

    test('error() is undefined when no error boundary covers the path', async () => {
        const uncovered = createViewResolver({ pages, layouts })
        expect(await uncovered.error('/admin')).toBeUndefined()
    })

    test('prefixes() reports the matched layout and error prefixes for diagnostics', () => {
        expect(resolver.prefixes('/admin')).toEqual({ layout: '/admin', error: '/' })
        expect(resolver.prefixes('/')).toEqual({ layout: '/', error: '/' })
    })
})
