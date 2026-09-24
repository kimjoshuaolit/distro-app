import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  accessFor,
  accessKey,
  classifyAccessError,
  RETRY_DELAYS_MS,
  runAccessCheck,
  toGateAccess,
  type KeyedAccess,
} from './accessCheck'
import { coupleGate } from './coupleGate'

// Same shape as src/lib/coupleAuth.ts AccessCheckError (recognized structurally).
function accessError(status: number, code = '') {
  const err = new Error('Could not open this reveal.') as Error & { status: number; code: string }
  err.name = 'AccessCheckError'
  err.status = status
  err.code = code
  return err
}

const schedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms)
  return () => clearTimeout(t)
}

/** Drive runAccessCheck like the hook does: keep only the latest update. */
function harness(check: () => Promise<'granted' | 'denied'>, key = accessKey('u1', 'a@x.test', 'e1', 0)) {
  let stored: KeyedAccess | null = null
  const updates: KeyedAccess[] = []
  const cancel = runAccessCheck(key, {
    check,
    schedule,
    onUpdate: (u) => {
      stored = u
      updates.push(u)
    },
  })
  return { key, cancel, updates, current: () => accessFor(stored, key), gate: () => coupleGate(
    { userId: 'u1', email: 'a@x.test' }, toGateAccess(accessFor(stored, key)), null, 'exists') }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('classifyAccessError', () => {
  it('network failures, timeouts, 5xx, 408 and 429 are transient', () => {
    for (const s of [0, 500, 502, 503, 408, 429]) expect(classifyAccessError(accessError(s)), String(s)).toBe('transient')
  })

  it('401 (expired / rejected JWT) is unauthorized', () => {
    expect(classifyAccessError(accessError(401, 'PGRST303'))).toBe('unauthorized')
  })

  it('42501 and other 4xx are permanent', () => {
    expect(classifyAccessError(accessError(403, '42501'))).toBe('permanent')
    expect(classifyAccessError(accessError(401, '42501'))).toBe('permanent')
    expect(classifyAccessError(accessError(400, 'PGRST100'))).toBe('permanent')
    expect(classifyAccessError(accessError(404))).toBe('permanent')
  })

  it('unexpected errors are transient (still bounded by the retry cap)', () => {
    expect(classifyAccessError(new TypeError('boom'))).toBe('transient')
  })
})

describe('runAccessCheck', () => {
  it('reports granted / denied straight through', async () => {
    const g = harness(() => Promise.resolve('granted'))
    await vi.runAllTimersAsync()
    expect(g.current()).toEqual({ status: 'granted' })
    expect(g.gate()).toEqual({ view: 'granted' })

    const d = harness(() => Promise.resolve('denied'))
    await vi.runAllTimersAsync()
    expect(d.gate()).toEqual({ view: 'denied' })
  })

  it('a transient error schedules a re-check, and a later answer reaches the gate', async () => {
    const check = vi
      .fn<() => Promise<'granted' | 'denied'>>()
      .mockRejectedValueOnce(accessError(0))
      .mockResolvedValueOnce('granted')
    const h = harness(check)

    await vi.advanceTimersByTimeAsync(0)
    expect(h.current()).toEqual({ status: 'retrying', retry: 1, delayMs: 3_000 })
    expect(h.gate()).toEqual({ view: 'loading' }) // never "denied" on a blip
    expect(check).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2_999)
    expect(check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(check).toHaveBeenCalledTimes(2)
    expect(h.gate()).toEqual({ view: 'granted' })
  })

  it('backs off 3s → 6s → 12s → 24s → 48s, then stops in a terminal error', async () => {
    const check = vi.fn<() => Promise<'granted' | 'denied'>>().mockRejectedValue(accessError(503))
    const h = harness(check)

    await vi.advanceTimersByTimeAsync(0)
    const delays: number[] = []
    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
      const s = h.current()
      expect(s.status).toBe('retrying')
      if (s.status === 'retrying') delays.push(s.delayMs)
      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[i])
    }
    expect(delays).toEqual([3_000, 6_000, 12_000, 24_000, 48_000])
    expect(check).toHaveBeenCalledTimes(1 + RETRY_DELAYS_MS.length) // first try + 5 retries
    expect(h.current()).toEqual({ status: 'failed', unauthorized: false })
    expect(h.gate()).toEqual({ view: 'error' })

    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(check).toHaveBeenCalledTimes(6) // capped: nothing further scheduled
  })

  it('a permanent error ends in the terminal state without retrying', async () => {
    const check = vi.fn<() => Promise<'granted' | 'denied'>>().mockRejectedValue(accessError(403, '42501'))
    const h = harness(check)
    await vi.runAllTimersAsync()
    expect(check).toHaveBeenCalledTimes(1)
    expect(h.current()).toEqual({ status: 'failed', unauthorized: false })
    expect(h.gate()).toEqual({ view: 'error' })
  })

  it('a 401 ends terminal and flags a local sign-out', async () => {
    const check = vi.fn<() => Promise<'granted' | 'denied'>>().mockRejectedValue(accessError(401, 'PGRST303'))
    const h = harness(check)
    await vi.runAllTimersAsync()
    expect(check).toHaveBeenCalledTimes(1)
    expect(h.current()).toEqual({ status: 'failed', unauthorized: true })
  })

  it('after cancel, neither a late answer nor a pending retry reports anything', async () => {
    let resolve!: (v: 'granted') => void
    const late = harness(() => new Promise((r) => (resolve = r)))
    late.cancel()
    resolve('granted')
    await vi.runAllTimersAsync()
    expect(late.updates).toEqual([])

    const check = vi.fn<() => Promise<'granted' | 'denied'>>().mockRejectedValue(accessError(0))
    const retrying = harness(check)
    await vi.advanceTimersByTimeAsync(0)
    retrying.cancel()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(check).toHaveBeenCalledTimes(1)
  })
})

describe('keying (accessFor)', () => {
  const granted: KeyedAccess = { key: accessKey('u1', 'a@x.test', 'e1', 0), snapshot: { status: 'granted' } }

  it('shows a result only for exactly the current key', () => {
    expect(accessFor(granted, accessKey('u1', 'a@x.test', 'e1', 0))).toEqual({ status: 'granted' })
  })

  it('never shows a result keyed to an old user, email, event or attempt', () => {
    expect(accessFor(granted, accessKey('u2', 'a@x.test', 'e1', 0))).toEqual({ status: 'checking' })
    expect(accessFor(granted, accessKey('u1', 'b@x.test', 'e1', 0))).toEqual({ status: 'checking' }) // email changed
    expect(accessFor(granted, accessKey('u1', 'a@x.test', 'e2', 0))).toEqual({ status: 'checking' })
    expect(accessFor(granted, accessKey('u1', 'a@x.test', 'e1', 1))).toEqual({ status: 'checking' }) // "Try again"
    expect(accessFor(granted, null)).toEqual({ status: 'checking' })
    expect(accessFor(null, granted.key)).toEqual({ status: 'checking' })
  })

  it('keys are unambiguous (no delimiter collisions)', () => {
    expect(accessKey('u|1', null, 'e', 0)).not.toBe(accessKey('u', '1', 'e', 0))
  })

  it('maps snapshots onto the gate', () => {
    expect(toGateAccess({ status: 'checking' })).toBe('checking')
    expect(toGateAccess({ status: 'retrying', retry: 1, delayMs: 3_000 })).toBe('checking')
    expect(toGateAccess({ status: 'granted' })).toBe('granted')
    expect(toGateAccess({ status: 'denied' })).toBe('denied')
    expect(toGateAccess({ status: 'failed', unauthorized: false })).toBe('error')
  })
})
