import { createLivenessWatch } from './createLivenessWatch.ts'
import { originOf } from './originOf.ts'

/*
The reachability registry behind `belte/shared/reachable`. A probe transport,
the timings, and an optional change notifier are injected so the public name
wires them per side (server HEAD + env timings; browser no-cors HEAD + a
reactive notifier) while tests drive scripted outcomes on tiny intervals.

Per origin, the first read awaits one real probe (the FAITHFUL first answer —
its latency, including a full timeout when the host is down, is the price of
not guessing) and then hands the origin to a createLivenessWatch that re-probes
every `intervalMs` to keep the value warm. Every later read resolves instantly
off that warm value, fresh within one interval — the faithful cost is paid once.

The inaugural probe runs DIRECTLY, not through the watch: the watch's
failureLimit (anti-flap) is right for the ongoing poll but would make a down
host take failureLimit× the timeout to answer on the first call. The watch's
injected probe doubles as the idle reaper — a host nobody has read in `idleMs`
stops polling (stop() during the probe changes the watched url, so the watch
discards the result and never reschedules); the next read restarts it cold.
*/
export function createReachable(options: {
    probe: (origin: string) => Promise<boolean>
    intervalMs: number
    idleMs: number
    /* Called with the origin whenever its warm value flips — the client wires
       this to a per-origin reactive subscriber so reads re-run on up/down. */
    notify?: (origin: string) => void
}): {
    reachable: (host: string | URL) => Promise<boolean>
    /* Stop every origin's poll — graceful shutdown, and test isolation. */
    stop: () => void
    /* `using registry = createReachable(...)` — disposal stops every poll. */
    [Symbol.dispose]: () => void
} {
    type Entry = {
        alive: boolean
        /* The inaugural probe while it is still in flight; concurrent cold reads await the same one. */
        inflight: Promise<boolean> | undefined
        watch: ReturnType<typeof createLivenessWatch> | undefined
        lastReadAt: number
    }
    const registry = new Map<string, Entry>()

    /* The ongoing poll's probe: reap an idle origin, else run the real probe. */
    function watchProbe(origin: string): Promise<boolean> {
        const entry = registry.get(origin)
        if (entry && Date.now() - entry.lastReadAt > options.idleMs) {
            entry.watch?.stop()
            registry.delete(origin)
            /* Discarded — stop() moved the watched url, so the watch won't reschedule. */
            return Promise.resolve(false)
        }
        return options.probe(origin)
    }

    function startWatch(entry: Entry, origin: string): void {
        entry.watch = createLivenessWatch({
            probe: watchProbe,
            onChange: (alive) => {
                entry.alive = alive
                options.notify?.(origin)
            },
            intervalMs: options.intervalMs,
        })
        entry.watch.watch(origin)
    }

    async function reachable(host: string | URL): Promise<boolean> {
        const origin = originOf(host)
        const existing = registry.get(origin)
        if (existing) {
            existing.lastReadAt = Date.now()
            return existing.inflight ?? existing.alive
        }
        /* Cold: optimistic seed, but the first read awaits a real probe before returning. */
        const entry: Entry = {
            alive: true,
            inflight: undefined,
            watch: undefined,
            lastReadAt: Date.now(),
        }
        registry.set(origin, entry)
        /* A rejecting probe reads as unreachable, not a permanent wedge: without
           the catch a thrown probe leaves inflight set forever (every later read
           returns the rejected promise) and never starts the watch. */
        entry.inflight = options
            .probe(origin)
            .catch(() => false)
            .then((alive) => {
                entry.alive = alive
                entry.inflight = undefined
                startWatch(entry, origin)
                return alive
            })
        return entry.inflight
    }

    function stop(): void {
        for (const entry of registry.values()) {
            entry.watch?.stop()
        }
        registry.clear()
    }

    return { reachable, stop, [Symbol.dispose]: stop }
}
