/*
Given a route URL and a sorted list of directory prefixes that have a
layout.svelte, returns the deepest prefix that is an ancestor of the route.
Returns undefined when no layout applies. Implements the "nearest-only"
resolution from the plan — no stacking.
*/
export function nearestLayoutPrefix(
    routeUrl: string,
    layoutPrefixes: Iterable<string>,
): string | undefined {
    const normalized = routeUrl === '/' ? '' : routeUrl.replace(/^\//, '')
    let best: string | undefined
    for (const prefix of layoutPrefixes) {
        const dir = prefix === '/' ? '' : prefix.replace(/^\//, '')
        if (dir === '' || normalized === dir || normalized.startsWith(`${dir}/`)) {
            if (
                best === undefined ||
                dir.length > (best === '/' ? 0 : best.replace(/^\//, '').length)
            ) {
                best = prefix
            }
        }
    }
    return best
}
