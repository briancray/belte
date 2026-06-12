import { BELTE_VERSION } from '../../shared/BELTE_VERSION.ts'
import { belteLog } from '../../shared/belteLog.ts'
import type { AppModule } from '../AppModule.ts'

/*
The canonical /__belte/health payload: the app health(request) hook's fields
under the framework identity keys, which win on collision. A thrown or
non-object hook degrades to no fields — an app bug must not masquerade as an
unreachable server, so the base payload always builds. Shared by the
health/identity routes and the SSR renderer's __SSR__.health seed so the
wire and the seed can't drift.
*/
export async function buildHealthPayload(
    request: Request,
    opts: { app?: AppModule; appName: string; appVersion: string },
): Promise<Record<string, unknown>> {
    let fields: Record<string, unknown> = {}
    if (opts.app?.health) {
        try {
            const result = await opts.app.health(request)
            if (result && typeof result === 'object' && !Array.isArray(result)) {
                fields = result as Record<string, unknown>
            }
        } catch (error) {
            belteLog.error(error)
        }
    }
    /*
    `belte` carries the framework version — truthy for the probe check,
    informative for skew diagnosis. The IDENTITY_PATH alias overrides it to
    the legacy `belte: true` shape at its call site.
    */
    return { ...fields, belte: BELTE_VERSION, name: opts.appName, version: opts.appVersion }
}
