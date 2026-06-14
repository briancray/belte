import type { BufferedRecord, createEventBuffer } from './createEventBuffer.ts'

/* Shorter than Bun's 10s idle default so the connection stays live even if the
   stream isn't otherwise opted out of the timeout — a keepalive backstop. */
const HEARTBEAT_MS = 5_000

/* JSON, degrading a non-serializable `data` field to its String form rather
   than dropping the whole record — same resilience as the unified log's json. */
function safeJson(record: unknown): string {
    try {
        return JSON.stringify(record)
    } catch {
        return JSON.stringify({
            ...(record as object),
            data: String((record as { data?: unknown }).data),
        })
    }
}

/*
The live feed as Server-Sent Events. Each frame carries `id: <epoch>:<seq>`, so
on reconnect the browser's Last-Event-ID lets the server resume after the last
record the client saw instead of replaying the whole buffer (the duplicate-logs
bug). A mismatched epoch means a fresh worker — replay its tail from the start.
A comment heartbeat is the keepalive backstop; subscription + heartbeat tear
down on cancel.
*/
export function eventStreamResponse(
    buffer: ReturnType<typeof createEventBuffer<unknown>>,
    lastEventId: string | undefined,
): Response {
    // Last-Event-ID is `<epoch>:<seq>`; a different (or absent) epoch replays the tail.
    const [clientEpoch, clientSequence] = (lastEventId ?? '').split(':')
    const afterId = clientEpoch === buffer.epoch ? Number(clientSequence) || 0 : 0

    let unsubscribe: (() => void) | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const send = (entry: BufferedRecord<unknown>) =>
                controller.enqueue(
                    encoder.encode(
                        `id: ${buffer.epoch}:${entry.id}\ndata: ${safeJson(entry.record)}\n\n`,
                    ),
                )
            for (const entry of buffer.since(afterId)) {
                send(entry)
            }
            unsubscribe = buffer.subscribe(send)
            heartbeat = setInterval(
                () => controller.enqueue(encoder.encode(': ping\n\n')),
                HEARTBEAT_MS,
            )
        },
        cancel() {
            unsubscribe?.()
            if (heartbeat) {
                clearInterval(heartbeat)
            }
        },
    })
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
        },
    })
}
