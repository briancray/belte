import { beforeAll, describe, expect, test } from 'bun:test'
import { navigate } from '../src/lib/ui/navigate.ts'
import { router } from '../src/lib/ui/router.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

describe('router', () => {
    test('mounts the matching page and re-mounts on navigate', () => {
        const host = document.createElement('div')
        const page = (label: string) => (target: Element) => {
            target.appendChild(document.createTextNode(label))
            return () => undefined
        }
        const dispose = router(host, {
            '/': page('home'),
            '/about': page('about'),
            '*': page('not found'),
        })

        navigate('/')
        expect(host.textContent).toBe('home')

        navigate('/about')
        expect(host.textContent).toBe('about') // old page cleared, new mounted

        navigate('/missing')
        expect(host.textContent).toBe('not found') // falls back to '*'

        navigate('/')
        expect(host.textContent).toBe('home')

        dispose()
    })
})
