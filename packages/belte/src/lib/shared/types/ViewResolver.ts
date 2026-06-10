import type { ResolvedView } from './ResolvedView.ts'

/*
Everything a renderer needs to turn a matched route into mountable
components. `view` rejects on an unknown route or a failed module import;
`error` answers undefined when no error.svelte covers the path; `prefixes`
exposes the matched layout/error prefix names — diagnostics, plus the client
boundary's synchronous is-covered check before it commits to an error view.
*/
export type ViewResolver = {
    has: (route: string) => boolean
    view: (route: string) => Promise<ResolvedView>
    error: (pathname: string) => Promise<ResolvedView | undefined>
    prefixes: (route: string) => { layout: string | undefined; error: string | undefined }
}
