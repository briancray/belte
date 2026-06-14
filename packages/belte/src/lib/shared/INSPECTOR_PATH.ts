/*
Mount root of the opt-in inspector surface (the `@belte/inspector` package,
activated by BELTE_ENABLE_INSPECTOR=true). The UI sits at this exact path; its
data endpoints (`/surface`, `/events`) live under `${INSPECTOR_PATH}/`. Shared
so createServer's route gate and the inspector handler agree on the prefix.
*/
export const INSPECTOR_PATH = '/__belte/inspector'
