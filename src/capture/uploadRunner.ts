import type { Shot } from './db'
import { nextDelay } from './uploadQueue'

// 'checking' = before the first look at the queue (render nothing yet).
export type RunnerState = 'checking' | 'idle' | 'uploading' | 'offline' | 'error'

export type RunnerSnapshot = { state: RunnerState; pending: number; rejected: number }

// Everything the runner touches is injected, so the scheduling logic runs in
// plain node under vitest fake timers (no DOM, no IndexedDB, no network).
export type RunnerDeps = {
  getPending: () => Promise<Shot[]>
  countRejected: () => Promise<number>
  drain: (shots: Shot[]) => Promise<{ allSettled: boolean }>
  isOffline: () => boolean
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  onChange: (snapshot: RunnerSnapshot) => void
}

/** While offline, re-check this often in case the 'online' event never fires. */
export const OFFLINE_POLL_MS = 15_000

/**
 * Background upload scheduler (AD-1: never blocks capture).
 * - One drain in flight; a `run()` during a drain queues exactly one more pass.
 * - Transient failures back off exponentially; `wake()` (online / app visible)
 *   resets the backoff and drains now.
 * - Any unexpected error becomes an 'error' state plus a scheduled retry, never
 *   a silent stall. After `dispose()` nothing is scheduled or emitted.
 */
export function createUploadRunner(deps: RunnerDeps) {
  let running = false
  let rerun = false
  let disposed = false
  let attempt = 0
  let timer: unknown = null
  let snap: RunnerSnapshot = { state: 'checking', pending: 0, rejected: 0 }

  const emit = (patch: Partial<RunnerSnapshot>) => {
    if (disposed) return
    snap = { ...snap, ...patch }
    deps.onChange(snap)
  }

  const schedule = (ms: number) => {
    if (disposed) return
    if (timer !== null) deps.clearTimer(timer)
    timer = deps.setTimer(() => {
      timer = null
      void run()
    }, ms)
  }

  const refreshCounts = async (): Promise<Shot[]> => {
    const [pending, rejected] = await Promise.all([deps.getPending(), deps.countRejected()])
    emit({ pending: pending.length, rejected })
    return pending
  }

  async function run(): Promise<void> {
    if (disposed) return
    if (running) {
      rerun = true
      return
    }
    running = true
    try {
      do {
        rerun = false
        const pending = await refreshCounts()
        if (disposed) return
        if (pending.length === 0) {
          emit({ state: 'idle' })
          continue // honours a run() that arrived while we were reading
        }
        if (deps.isOffline()) {
          emit({ state: 'offline' })
          schedule(OFFLINE_POLL_MS)
          return
        }
        emit({ state: 'uploading' })
        const { allSettled } = await deps.drain(pending)
        const left = await refreshCounts()
        if (disposed) return
        if (allSettled) {
          attempt = 0
          // Only genuinely new shots (captured mid-drain) earn another pass —
          // never loop on the batch we just settled.
          const drained = new Set(pending.map((s) => s.id))
          const fresh = left.some((s) => !drained.has(s.id))
          emit({ state: fresh ? 'uploading' : 'idle' })
          if (fresh) rerun = true
          continue
        }
        emit({ state: deps.isOffline() ? 'offline' : 'error' })
        schedule(nextDelay(attempt++))
        return
      } while (rerun && !disposed)
    } catch {
      emit({ state: 'error' })
      schedule(nextDelay(attempt++))
    } finally {
      running = false
    }
  }

  return {
    /** Drain now (e.g. after a capture). Coalesces with an in-flight drain. */
    run,
    /** Connectivity or visibility came back: reset backoff and drain now. */
    wake(): void {
      attempt = 0
      if (timer !== null) {
        deps.clearTimer(timer)
        timer = null
      }
      void run()
    },
    dispose(): void {
      disposed = true
      if (timer !== null) deps.clearTimer(timer)
      timer = null
    },
    snapshot: (): RunnerSnapshot => snap,
  }
}
