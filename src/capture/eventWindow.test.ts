import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { EventStatus } from '../lib/api'
import {
  createWindowWatcher,
  lockStorageKey,
  nextLock,
  nextState,
  OPEN_STATE,
  parseStoredState,
  WINDOW_CHECK_MS,
  type WindowState,
} from './eventWindow'

describe('nextLock', () => {
  it('follows a positive server answer', () => {
    expect(nextLock('open', { state: 'ended' })).toBe('closed')
    expect(nextLock('open', { state: 'pending', opensAt: '2026-11-14T06:00:00Z' })).toBe('pending')
    expect(nextLock('closed', { state: 'open' })).toBe('open') // Kim re-opened it
  })

  it('offline or a failed check never locks (and never unlocks) — capture doesn’t wait on the network', () => {
    for (const prev of ['open', 'closed', 'pending'] as const) {
      expect(nextLock(prev, { state: 'error' })).toBe(prev)
      expect(nextLock(prev, { state: 'invalid' })).toBe(prev)
    }
  })
})

describe('nextState', () => {
  it('carries when a pending camera opens, and keeps it through "no news"', () => {
    const pending = nextState(OPEN_STATE, { state: 'pending', opensAt: '2026-11-14T06:00:00Z' })
    expect(pending).toEqual({ lock: 'pending', opensAt: '2026-11-14T06:00:00Z' })
    expect(nextState(pending, { state: 'error' })).toEqual(pending)
    expect(nextState(pending, { state: 'open' })).toEqual(OPEN_STATE)
    expect(nextState(pending, { state: 'ended' })).toEqual({ lock: 'closed', opensAt: null })
  })
})

// A controllable status source: each call returns a promise the test resolves.
function statusSource() {
  const pending: Array<(s: EventStatus) => void> = []
  const fetchStatus = vi.fn(() => new Promise<EventStatus>((resolve) => pending.push(resolve)))
  return { fetchStatus, answer: (i: number, s: EventStatus) => pending[i](s), calls: () => pending.length }
}

describe('createWindowWatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const every = (fn: () => void, ms: number) => {
    const t = setInterval(fn, ms)
    return () => clearInterval(t)
  }

  it('checks at start, then about once a minute while visible — and locks on "ended"', async () => {
    const src = statusSource()
    const changes: WindowState[] = []
    const w = createWindowWatcher({ fetchStatus: src.fetchStatus, onChange: (s) => changes.push(s), initial: OPEN_STATE, every, isVisible: () => true })
    const stop = w.start()
    expect(src.calls()).toBe(1)
    src.answer(0, { state: 'open' })
    await vi.advanceTimersByTimeAsync(WINDOW_CHECK_MS)
    expect(src.calls()).toBe(2)
    src.answer(1, { state: 'ended' })
    await vi.advanceTimersByTimeAsync(0)
    expect(changes).toEqual([{ lock: 'closed', opensAt: null }])
    stop()
  })

  it('a hidden page doesn’t poll', async () => {
    const src = statusSource()
    let visible = false
    const w = createWindowWatcher({ fetchStatus: src.fetchStatus, onChange: () => {}, initial: OPEN_STATE, every, isVisible: () => visible })
    w.start()
    await vi.advanceTimersByTimeAsync(WINDOW_CHECK_MS * 3)
    expect(src.calls()).toBe(1) // only the start check
    visible = true
    await vi.advanceTimersByTimeAsync(WINDOW_CHECK_MS)
    expect(src.calls()).toBe(2)
  })

  it('only the newest answer counts: a slow old "open" can’t unlock a camera a newer answer closed', async () => {
    const src = statusSource()
    const changes: WindowState[] = []
    const w = createWindowWatcher({ fetchStatus: src.fetchStatus, onChange: (s) => changes.push(s), initial: OPEN_STATE, every, isVisible: () => true })
    w.start() // request 0
    w.check() // request 1 (e.g. back online)
    src.answer(1, { state: 'ended' })
    await vi.advanceTimersByTimeAsync(0)
    src.answer(0, { state: 'open' }) // stale
    await vi.advanceTimersByTimeAsync(0)
    expect(changes).toEqual([{ lock: 'closed', opensAt: null }])
  })

  it('offline answers change nothing; a thrown check is harmless; nothing fires after stop', async () => {
    const onChange = vi.fn()
    let n = 0
    const fetchStatus = vi.fn(async (): Promise<EventStatus> => {
      n++
      if (n === 2) throw new Error('boom')
      return { state: 'error' }
    })
    const w = createWindowWatcher({ fetchStatus, onChange, initial: { lock: 'closed', opensAt: null }, every, isVisible: () => true })
    const stop = w.start()
    await vi.advanceTimersByTimeAsync(WINDOW_CHECK_MS * 2)
    expect(onChange).not.toHaveBeenCalled()
    stop()
    w.check()
    await vi.advanceTimersByTimeAsync(WINDOW_CHECK_MS * 2)
    expect(fetchStatus).toHaveBeenCalledTimes(3)
  })
})

describe('parseStoredState', () => {
  it('reads back what was saved', () => {
    expect(parseStoredState(JSON.stringify({ lock: 'closed', opensAt: null }))).toEqual({ lock: 'closed', opensAt: null })
    expect(parseStoredState(JSON.stringify({ lock: 'pending', opensAt: 'x' }))).toEqual({ lock: 'pending', opensAt: 'x' })
  })
  it('anything else is nothing (start open)', () => {
    for (const raw of [null, '', 'nope', '{}', JSON.stringify({ lock: 'locked' }), '[]']) {
      expect(parseStoredState(raw), String(raw)).toBeNull()
    }
  })
  it('is keyed per event', () => {
    expect(lockStorageKey('e1')).not.toBe(lockStorageKey('e2'))
  })
})
