/*
The canonical liveness/health endpoint: the identity payload plus whatever
the app's optional `health(request)` hook contributes. `/__belte/identity`
stays as a compatibility alias serving the same payload (older launchers
probe it; probeBelteServer falls back to it for older servers).
*/
export const HEALTH_PATH = '/__belte/health'
