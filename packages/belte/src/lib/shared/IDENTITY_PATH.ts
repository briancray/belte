/*
Path of the identity probe answering `{ belte, name, version }` ahead of any
app middleware. Shared so the server mount (createServer) and the launcher's
probe (probeBelteServer) agree on the path.
*/
export const IDENTITY_PATH = '/__belte/identity'
