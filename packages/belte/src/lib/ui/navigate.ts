import { runtimePath } from './runtime/runtimePath.ts'

/* Navigates to `path`: pushes a history entry (when available) and updates the
   reactive route, which re-mounts the matching page via `router`. */
// @readme plumbing
export function navigate(path: string): void {
    if (typeof history !== 'undefined') {
        history.pushState({}, '', path)
    }
    runtimePath.value = path
}
