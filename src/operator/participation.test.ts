import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createRefresher,
  formatAgo,
  nextDashboard,
  PARTICIPATION_REFRESH_MS,
  toGuestRows,
  totals,
  type GuestParticipation,
  type RefreshResult,
} from './participation'

const rosa = {
  guest_id: 'b1b1b1b1-0000-4000-8000-000000000001',
  first_name: 'Rosa',
  joined_at: '2026-11-14T20:00:00+00:00',
  photos_saved: 3,
  clips_saved: 1,
  on_the_way: 2,
  last_shot_at: '2026-11-14T21:40:00+00:00',
}
const sam = { ...rosa, guest_id: 'b1b1b1b1-0000-4000-8000-000000000002', first_name: 'Sam', photos_saved: 0, clips_saved: 0, on_the_way: 0, last_shot_at: null }

describe('toGuestRows', () => {
  it('maps the RPC rows, keeping their order (newest joiner first)', () => {
    expect(toGuestRows([sam, rosa])).toEqual([
      { guestId: sam.guest_id, firstName: 'Sam', joinedAt: sam.joined_at, photosSaved: 0, clipsSaved: 0, onTheWay: 0, lastShotAt: null },
      { guestId: rosa.guest_id, firstName: 'Rosa', joinedAt: rosa.joined_at, photosSaved: 3, clipsSaved: 1, onTheWay: 2, lastShotAt: rosa.last_shot_at },
    ])
  })

  it('keeps two guests with the same name apart', () => {
    const twin = { ...sam, guest_id: 'b1b1b1b1-0000-4000-8000-000000000003' }
    expect(toGuestRows([twin, sam]).map((r) => r.guestId)).toEqual([twin.guest_id, sam.guest_id])
  })

  it('drops malformed rows and non-arrays', () => {
    expect(toGuestRows(null)).toEqual([])
    expect(toGuestRows({})).toEqual([])
    expect(toGuestRows([null, 'x', { ...rosa, guest_id: 1 }, { ...rosa, photos_saved: -1 }, { ...rosa, clips_saved: '2' }, { ...rosa, on_the_way: 1.5 }, { ...rosa, joined_at: 'soon' }])).toEqual([])
  })

  it('an unreadable last-shot time reads as none (never "Invalid Date")', () => {
    expect(toGuestRows([{ ...rosa, last_shot_at: 'later' }])[0].lastShotAt).toBeNull()
  })
})

describe('totals', () => {
  it('adds up guests, saved photos and clips, and what is on the way', () => {
    expect(totals(toGuestRows([sam, rosa]))).toEqual({ guests: 2, photos: 3, clips: 1, onTheWay: 2 })
    expect(totals([])).toEqual({ guests: 0, photos: 0, clips: 0, onTheWay: 0 })
  })
})

describe('formatAgo', () => {
  const now = new Date('2026-11-14T22:00:00Z')
  it('reads like a glance', () => {
    expect(formatAgo('2026-11-14T21:59:30Z', now)).toBe('just now')
    expect(formatAgo('2026-11-14T22:03:00Z', now)).toBe('just now') // clock skew
    expect(formatAgo('2026-11-14T21:48:00Z', now)).toBe('12 min ago')
    expect(formatAgo('2026-11-14T19:30:00Z', now)).toBe('2 h ago')
    expect(formatAgo('2026-11-11T21:00:00Z', now)).toBe('3 d ago')
    expect(formatAgo('nonsense', now)).toBe('')
  })
})

describe('nextDashboard', () => {
  const at = new Date('2026-11-14T21:41:00Z')
  const later = new Date('2026-11-14T21:42:00Z')

  it('shows the first answer, and a later one replaces it', () => {
    const ready = nextDashboard<string>({ status: 'loading' }, { ok: true, value: 'a', at })
    expect(ready).toEqual({ status: 'ready', value: 'a', updatedAt: at, stale: false })
    expect(nextDashboard(ready, { ok: true, value: 'b', at: later })).toEqual({ status: 'ready', value: 'b', updatedAt: later, stale: false })
  })

  it('a failed refresh keeps the last data and marks it stale; the next success clears it', () => {
    const ready = nextDashboard<string>({ status: 'loading' }, { ok: true, value: 'a', at })
    const stale = nextDashboard(ready, { ok: false })
    expect(stale).toEqual({ status: 'ready', value: 'a', updatedAt: at, stale: true })
    expect(nextDashboard(stale, { ok: true, value: 'a', at: later })).toMatchObject({ stale: false, updatedAt: later })
  })

  it('a failure with nothing on screen is "failed"; a null answer is "missing"', () => {
    expect(nextDashboard<string>({ status: 'loading' }, { ok: false })).toEqual({ status: 'failed' })
    expect(nextDashboard<string>({ status: 'failed' }, { ok: false })).toEqual({ status: 'failed' })
    expect(nextDashboard<string>({ status: 'loading' }, { ok: true, value: null, at })).toEqual({ status: 'missing' })
  })

  it('"not found" stays "not found" through a later failed refresh', () => {
    expect(nextDashboard<string>({ status: 'missing' }, { ok: false })).toEqual({ status: 'missing' })
  })
})

// A controllable loader: each call returns a promise the test settles.
function loader() {
  const calls: Array<{ resolve: (r: GuestParticipation[]) => void; reject: (e: unknown) => void }> = []
  const load = vi.fn(() => new Promise<GuestParticipation[]>((resolve, reject) => calls.push({ resolve, reject })))
  return { load, calls }
}

describe('createRefresher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const every = (fn: () => void, ms: number) => {
    const t = setInterval(fn, ms)
    return () => clearInterval(t)
  }
  const rows = toGuestRows([rosa])
  const at = new Date('2026-11-14T22:00:00Z')

  function setup(visible = { v: true }) {
    const src = loader()
    const results: RefreshResult<GuestParticipation[]>[] = []
    const busy: boolean[] = []
    const r = createRefresher({
      load: src.load,
      onResult: (x) => results.push(x),
      onBusy: (b) => busy.push(b),
      every,
      isVisible: () => visible.v,
      now: () => at,
    })
    return { src, results, busy, r }
  }

  it('loads on start, then once a minute while visible', async () => {
    const { src, results, busy, r } = setup()
    r.start()
    expect(src.load).toHaveBeenCalledTimes(1)
    src.calls[0].resolve(rows)
    await vi.advanceTimersByTimeAsync(0)
    expect(results).toEqual([{ ok: true, value: rows, at }])
    expect(busy).toEqual([true, false])
    await vi.advanceTimersByTimeAsync(PARTICIPATION_REFRESH_MS)
    expect(src.load).toHaveBeenCalledTimes(2)
    r.stop()
  })

  it('a hidden tab does not poll', async () => {
    const visible = { v: false }
    const { src, r } = setup(visible)
    r.start()
    await vi.advanceTimersByTimeAsync(PARTICIPATION_REFRESH_MS * 3)
    expect(src.load).toHaveBeenCalledTimes(1) // only the load on open
    visible.v = true
    await vi.advanceTimersByTimeAsync(PARTICIPATION_REFRESH_MS)
    expect(src.load).toHaveBeenCalledTimes(2)
    r.stop()
  })

  it('reports a failed refresh (the page keeps its last data)', async () => {
    const { src, results, r } = setup()
    r.start()
    src.calls[0].reject(new Error('offline'))
    await vi.advanceTimersByTimeAsync(0)
    expect(results).toEqual([{ ok: false }])
    r.stop()
  })

  it('only the newest answer counts', async () => {
    const { src, results, busy, r } = setup()
    r.start()
    r.refresh() // Refresh tapped while the first load is slow
    src.calls[1].resolve(rows)
    await vi.advanceTimersByTimeAsync(0)
    src.calls[0].resolve([]) // the stale answer arrives late
    await vi.advanceTimersByTimeAsync(0)
    expect(results).toEqual([{ ok: true, value: rows, at }])
    expect(busy).toEqual([true, true, false])
    r.stop()
  })

  it('a loader that throws synchronously is a failed refresh', async () => {
    const results: RefreshResult<GuestParticipation[]>[] = []
    const r = createRefresher<GuestParticipation[]>({
      load: () => {
        throw new Error('boom')
      },
      onResult: (x) => results.push(x),
      onBusy: () => {},
      every,
      isVisible: () => true,
    })
    r.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(results).toEqual([{ ok: false }])
    r.stop()
  })

  it('reports nothing after stop, and stops polling', async () => {
    const { src, results, r } = setup()
    r.start()
    r.stop()
    src.calls[0].resolve(rows)
    await vi.advanceTimersByTimeAsync(PARTICIPATION_REFRESH_MS * 2)
    expect(results).toEqual([])
    expect(src.load).toHaveBeenCalledTimes(1)
    r.refresh()
    expect(src.load).toHaveBeenCalledTimes(1)
  })
})
