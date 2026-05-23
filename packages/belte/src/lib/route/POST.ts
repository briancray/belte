import type { RemoteFunction } from '../types/RemoteFunction.ts'
import type { RemoteHandler } from '../types/RemoteHandler.ts'
import type { RemoteOptions } from '../types/RemoteOptions.ts'

/*
Defines a POST endpoint inside an endpoint.ts file. The bundler plugin
substitutes the runtime per-importer; the static export here exists for the
type signature only and throws if invoked outside an endpoint.ts module.
*/
export function POST<Args = undefined, Return = unknown>(
    _handler: RemoteHandler<Args, Return>,
    _options?: RemoteOptions,
): RemoteFunction<Args, Return> {
    throw new Error(
        '[belte] `POST` was called outside an endpoint.ts module — verb helpers are only valid inside src/routes/**/endpoint.ts',
    )
}
