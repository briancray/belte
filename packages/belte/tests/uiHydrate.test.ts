import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { openRoot } from '../src/lib/ui/dom/openRoot.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

const COUNTER = `
    <script>
        let count = state(0)
        function inc() { count += 1 }
    </script>
    <main>
        <button onclick={inc}>count: {count}</button>
    </main>
`

describe('hydrate — adopt server DOM', () => {
    test('claims existing nodes (no re-render) and wires reactivity in place', () => {
        // 1) server render → HTML
        const server = new Function('doc', 'state', 'derived', 'effect', compileSSR(COUNTER))(
            doc,
            state,
            derived,
            effect,
        ) as SsrRender
        expect(server.html).toBe('<main><button>count: 0</button></main>')

        // 2) parse the SSR HTML into a host (as a browser would)
        const host = document.createElement('div')
        host.innerHTML = server.html
        const mainBefore = host.childNodes[0]
        const buttonBefore = (mainBefore as unknown as { childNodes: unknown[] })
            .childNodes[0] as unknown as {
            dispatchEvent: (event: { type: string }) => void
        }

        // 3) hydrate: adopt the existing DOM
        const body = compileComponent(COUNTER)
        const runtime = { doc, state, derived, effect, openChild, appendText, appendStatic, on }
        const names = Object.keys(runtime)
        hydrate(host, (target) => {
            new Function('host', ...names, body)(
                target,
                ...names.map((n) => runtime[n as keyof typeof runtime]),
            )
        })

        // adopted, not recreated: same node identities, no duplication
        expect(host.childNodes.length).toBe(1)
        expect(host.childNodes[0]).toBe(mainBefore) // <main> reused
        expect(host.textContent).toBe('count: 0')

        // reactivity wired onto the existing nodes
        buttonBefore.dispatchEvent({ type: 'click' })
        expect(host.textContent).toBe('count: 1')
        expect(host.childNodes[0]).toBe(mainBefore) // still the same node after update
    })

    test('adopts an if/else branch in place, then toggles', () => {
        // template-only component with an external doc, so the test can drive it
        const model = doc({ on: true, label: 'hi' })
        const source = `
            <main>
                <template if={model.on}>
                    <span>{model.label}</span>
                    <template else><b>off</b></template>
                </template>
            </main>
        `
        const runtime = {
            doc,
            state,
            derived,
            effect,
            openChild,
            openRoot,
            appendText,
            appendStatic,
            on,
            when,
            model,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])

        // server render (if true → the span branch)
        const server = new Function(
            'doc',
            'state',
            'derived',
            'effect',
            'model',
            compileSSR(source),
        )(doc, state, derived, effect, model) as SsrRender
        expect(server.html).toBe('<main><span>hi</span></main>')

        // parse + hydrate
        const host = document.createElement('div')
        host.innerHTML = server.html
        const spanBefore = (host.childNodes[0] as unknown as { childNodes: unknown[] })
            .childNodes[0]
        const body = compileComponent(source)
        hydrate(host, (target) => {
            new Function('host', ...names, body)(target, ...values)
        })

        // the branch node was adopted, not recreated
        const span = (host.childNodes[0] as unknown as { childNodes: unknown[] }).childNodes[0]
        expect(span).toBe(spanBefore)
        expect(host.textContent).toBe('hi')

        // reactive on the adopted node
        model.replace('label', 'yo')
        expect(host.textContent).toBe('yo')

        // toggle to the else branch (built fresh, post-hydration), and back
        model.replace('on', false)
        expect(host.textContent).toBe('off')
        model.replace('on', true)
        expect(host.textContent).toBe('yo')
    })
})
