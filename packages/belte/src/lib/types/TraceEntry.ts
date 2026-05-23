export type TraceEntry = {
    kind: 'module' | 'remote' | 'render' | 'middleware'
    label: string
    ms: number
}
