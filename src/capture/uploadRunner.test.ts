import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createUploadRunner,
  OFFLINE_POLL_MS,
  type RunnerDeps,
  type RunnerSnapshot,
} from './uploadRunner.ts'
import type { Shot } from './db.ts'

const shot = (id: string): Shot => ({
  id,
  eventId: 'E',
  guestId: 'G',
  type: 'photo',
  blob: new Blob(['x']),
  capturedAt: '2026-09-19T12:00:00.000Z',
  uploadStatus: 'local',
})

/** An in-memory stand-in for the IndexedDB queue. */
function makeStore(initial: Shot[] = []) {
  let pending = [...initial]
  return {
    add: (s: Shot) => void pending.push(s),
    getPending: async () => [...pending],
    settle: (batch: Shot[]) => {
      const ids = new Set(batch.map((b) => b.id))
      pending = pending.filter((p) => !ids.has(p.id))
    },
    size: () => pending.length,
  }
}

function setup(over: Partial<RunnerDeps> = {}) {
  const snaps: RunnerSnapshot[] = []
  const deps: RunnerDeps = {
    getPending: async () => [],
    countRejected: async () => 0,
    drain: async () => ({ allSettled: true }),
    isOffline: () => false,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onChange: (s) => void snaps.push(s),
    ...over,
  }
  const runner = createUploadRunner(deps)
  return { runner, snaps, last: () => snaps.at(-1) }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createUploadRunner', () => {
  it('starts in checking, then reports idle for an empty queue', async () => {
    const { runner, last } = setup()
    expect(runner.snapshot().state).toBe('checking')
    await runner.run()
    expect(last()).toEqual({ state: 'idle', pending: 0, rejected: 0 })
  })

  it('drains pending shots and ends idle with counts updated', async () => {
    const store = makeStore([shot('a'), shot('b')])
    const drain = vi.fn(async (batch: Shot[]) => (store.settle(batch), { allSettled: true }))
    const { runner, snaps, last } = setup({ getPending: store.getPending, drain })

    await runner.run()

    expect(drain).toHaveBeenCalledTimes(1)
    expect(snaps.some((s) => s.state === 'uploading' && s.pending === 2)).toBe(true)
    expect(last()).toMatchObject({ state: 'idle', pending: 0 })
  })

  it('surfaces the rejected count', async () => {
    const { runner, last } = setup({ countRejected: async () => 2 })
    await runner.run()
    expect(last()).toMatchObject({ state: 'idle', rejected: 2 })
  })

  it('backs off after a transient failure, then retries on the timer', async () => {
    const store = makeStore([shot('a')])
    let failing = true
    const drain = vi.fn(async (batch: Shot[]) => {
      if (failing) return { allSettled: false }
      store.settle(batch)
      return { allSettled: true }
    })
    const { runner, last } = setup({ getPending: store.getPending, drain })

    await runner.run()
    expect(last()?.state).toBe('error')
    expect(drain).toHaveBeenCalledTimes(1)

    failing = false
    await vi.advanceTimersByTimeAsync(999)
    expect(drain).toHaveBeenCalledTimes(1) // first backoff is 1s
    await vi.advanceTimersByTimeAsync(1)
    expect(drain).toHaveBeenCalledTimes(2)
    expect(last()).toMatchObject({ state: 'idle', pending: 0 })
  })

  it('grows the backoff, and wake() resets it and drains immediately', async () => {
    const store = makeStore([shot('a')])
    const drain = vi.fn(async () => ({ allSettled: false }))
    const { runner } = setup({ getPending: store.getPending, drain })

    await runner.run() // fail #1 -> retry in 1s
    await vi.advanceTimersByTimeAsync(1000) // fail #2 -> retry in 2s
    expect(drain).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1999)
    expect(drain).toHaveBeenCalledTimes(2)

    runner.wake() // e.g. 'online' / app visible again
    await flush()
    expect(drain).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1000) // backoff reset to 1s
    expect(drain).toHaveBeenCalledTimes(4)
  })

  it('does not attempt uploads while offline, and polls until back online', async () => {
    const store = makeStore([shot('a')])
    let offline = true
    const drain = vi.fn(async (batch: Shot[]) => (store.settle(batch), { allSettled: true }))
    const { runner, last } = setup({ getPending: store.getPending, drain, isOffline: () => offline })

    await runner.run()
    expect(last()).toMatchObject({ state: 'offline', pending: 1 })
    expect(drain).not.toHaveBeenCalled()

    offline = false
    await vi.advanceTimersByTimeAsync(OFFLINE_POLL_MS)
    expect(drain).toHaveBeenCalledTimes(1)
    expect(last()).toMatchObject({ state: 'idle', pending: 0 })
  })

  it('does not lose a run() that arrives while the queue is being read', async () => {
    const store = makeStore()
    let release!: () => void
    let firstRead = true
    const getPending = async () => {
      if (firstRead) {
        firstRead = false
        await new Promise<void>((r) => (release = r)) // first read is slow...
        return [] // ...and misses the shot captured meanwhile
      }
      return store.getPending()
    }
    const drain = vi.fn(async (batch: Shot[]) => (store.settle(batch), { allSettled: true }))
    const { runner, last } = setup({ getPending, drain })

    const first = runner.run()
    await flush()
    store.add(shot('new'))
    void runner.run() // the capture's bump, mid-read
    release()
    await first

    expect(drain).toHaveBeenCalledTimes(1)
    expect(last()).toMatchObject({ state: 'idle', pending: 0 })
  })

  it('drains shots captured during a drain in the same run', async () => {
    const store = makeStore([shot('a')])
    const drain = vi.fn(async (batch: Shot[]) => {
      store.settle(batch)
      if (batch[0].id === 'a') store.add(shot('b')) // captured mid-upload
      return { allSettled: true }
    })
    const { runner, last } = setup({ getPending: store.getPending, drain })

    await runner.run()

    expect(drain).toHaveBeenCalledTimes(2)
    expect(store.size()).toBe(0)
    expect(last()?.state).toBe('idle')
  })

  it('turns an unexpected error into an error state plus a scheduled retry', async () => {
    let reads = 0
    const getPending = async (): Promise<Shot[]> => {
      reads++
      if (reads === 1) throw new Error('IndexedDB unavailable')
      return []
    }
    const { runner, last } = setup({ getPending })

    await runner.run()
    expect(last()?.state).toBe('error') // not a misleading "All saved"

    await vi.advanceTimersByTimeAsync(1000)
    expect(reads).toBe(2)
    expect(last()?.state).toBe('idle')
  })

  it('stops scheduling and emitting after dispose', async () => {
    const store = makeStore([shot('a')])
    const drain = vi.fn(async () => ({ allSettled: false }))
    const { runner, snaps } = setup({ getPending: store.getPending, drain })

    await runner.run() // fails, schedules a retry
    const emitted = snaps.length
    runner.dispose()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(drain).toHaveBeenCalledTimes(1)
    expect(snaps.length).toBe(emitted)
  })
})
