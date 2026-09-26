import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BROKEN_WINDOW_MS,
  createCollectionSigner,
  loadFor,
  loadKey,
  MAX_FORCED_PER_ID,
  MAX_IN_FLIGHT,
  RETRY_DELAYS_MS,
  runLoad,
  SIGN_BATCH,
  type KeyedLoad,
  type SigningCache,
  type SigningSnapshot,
} from './collectionSigning'
import { MAX_VIEW_IDS } from '../../supabase/functions/_shared/view-rules.ts'
import { buildCollection, idsToSign } from './buildCollection'
import { VIEW_REFRESH_MARGIN_MS } from '../roll/rollSession'

const TTL_MS = 600_000

/**
 * A stub view-URL cache. By default it signs everything it's asked for with a
 * versioned URL; `answer` can drop ids (like a failed or partial request) or
 * hold the call open (to watch concurrency).
 */
function stubCache() {
  const calls: string[][] = []
  const invalidated: string[] = []
  const expiryAsks: Array<string[] | undefined> = []
  let version = 0
  let expiresAt: number | null = null
  let inFlight = 0
  let maxInFlight = 0
  let answer: (ids: string[]) => Promise<Record<string, string>> = async (ids) =>
    Object.fromEntries(ids.map((id) => [id, `https://r2/${id}?v=${version}`]))

  const cache: SigningCache = {
    async get(ids) {
      calls.push([...ids])
      version++
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        const got = await answer(ids)
        if (Object.keys(got).length > 0) expiresAt = Date.now() + TTL_MS
        return got
      } finally {
        inFlight--
      }
    },
    invalidate: (id) => void invalidated.push(id),
    nextExpiry(ids) {
      expiryAsks.push(ids ? [...ids] : undefined)
      return expiresAt
    },
  }
  return {
    cache,
    calls,
    invalidated,
    expiryAsks,
    maxInFlight: () => maxInFlight,
    setAnswer: (fn: typeof answer) => (answer = fn),
  }
}

const schedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms)
  return () => clearTimeout(t)
}

function harness(stub = stubCache()) {
  let snapshot: SigningSnapshot = { urls: {}, unavailable: new Set() }
  const signer = createCollectionSigner({
    cache: stub.cache,
    schedule,
    now: () => Date.now(),
    onChange: (s) => (snapshot = s),
  })
  return { ...stub, signer, snapshot: () => snapshot }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => vi.useRealTimers())

describe('batch size', () => {
  it('is the Edge Function’s own limit', () => {
    expect(SIGN_BATCH).toBe(MAX_VIEW_IDS)
  })
})

describe('collection signer — what gets signed', () => {
  const rolls = buildCollection({
    guests: [
      { id: 'a', firstName: 'Ana', createdAt: null },
      { id: 'b', firstName: 'Ben', createdAt: null },
    ],
    shots: [
      { id: 'a1', guestId: 'a', type: 'photo', capturedAt: '2026-09-19T10:00:00Z' },
      { id: 'a2', guestId: 'a', type: 'clip', capturedAt: '2026-09-19T11:00:00Z' },
      { id: 'b1', guestId: 'b', type: 'photo', capturedAt: '2026-09-19T10:00:00Z' },
    ],
  })

  it('signs the covers on the shelf, then only the open roll’s frames — not the covers again', async () => {
    const h = harness()
    h.signer.setNeeded(idsToSign(rolls, null))
    await flush()
    expect(h.calls).toEqual([['a1', 'b1']])
    expect(Object.keys(h.snapshot().urls).sort()).toEqual(['a1', 'b1'])

    h.signer.setNeeded(idsToSign(rolls, 'a'))
    await flush()
    expect(h.calls[1]).toEqual(['a1', 'a2'])
    expect(h.calls).toHaveLength(2)
  })

  it('only the ids on screen drive the refresh timer', async () => {
    const h = harness()
    h.signer.setNeeded(['a1', 'b1'])
    await flush()
    h.signer.setNeeded(['a2'])
    await flush()
    expect(h.expiryAsks.at(-1)).toEqual(['a2'])

    // The refresh fires shortly before the on-screen link expires, for the on-screen ids only.
    const callsBefore = h.calls.length
    await vi.advanceTimersByTimeAsync(TTL_MS - VIEW_REFRESH_MARGIN_MS - 1)
    expect(h.calls).toHaveLength(callsBefore)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.calls.at(-1)).toEqual(['a2'])
  })

  it('nothing on screen: no requests and no timers', async () => {
    const h = harness()
    h.signer.setNeeded([])
    await flush()
    expect(h.calls).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('collection signer — failures', () => {
  it('retries missing ids on a backoff (5s, 10s, 20s…) and stops once they arrive', async () => {
    const h = harness()
    let failB = 3
    h.setAnswer(async (ids) =>
      Object.fromEntries(ids.filter((id) => id !== 'b' || failB-- <= 0).map((id) => [id, `u:${id}`])),
    )
    h.signer.setNeeded(['a', 'b'])
    await flush()
    expect(h.calls).toEqual([['a', 'b']])

    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] - 1)
    expect(h.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.calls[1]).toEqual(['b']) // only what's missing

    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1])
    expect(h.calls[2]).toEqual(['b'])
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[2])
    expect(h.calls[3]).toEqual(['b'])
    expect(h.snapshot().urls.b).toBe('u:b')

    // Arrived: no more retries.
    const n = h.calls.length
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS.at(-1)! * 2)
    expect(h.calls).toHaveLength(n)
  })

  it('a whole failed round (nothing returned) is retried too, capped at the last delay', async () => {
    const h = harness()
    h.setAnswer(async () => ({}))
    h.signer.setNeeded(['a'])
    await flush()
    const total = RETRY_DELAYS_MS.reduce((s, d) => s + d, 0)
    await vi.advanceTimersByTimeAsync(total)
    expect(h.calls).toHaveLength(1 + RETRY_DELAYS_MS.length)
    // Past the schedule, it keeps the last (capped) delay.
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS.at(-1)!)
    expect(h.calls).toHaveLength(2 + RETRY_DELAYS_MS.length)
  })

  it('a rate-limited media error gets exactly one trailing re-sign when the window ends', async () => {
    const h = harness()
    h.signer.setNeeded(['a', 'b', 'c'])
    await flush()

    h.signer.reportBroken('a') // first: re-signed right away
    await flush()
    expect(h.calls.at(-1)).toEqual(['a'])
    expect(h.invalidated).toEqual(['a'])

    await vi.advanceTimersByTimeAsync(1_000)
    h.signer.reportBroken('b')
    await vi.advanceTimersByTimeAsync(1_000)
    h.signer.reportBroken('c')
    const before = h.calls.length
    await vi.advanceTimersByTimeAsync(BROKEN_WINDOW_MS - 2_001)
    expect(h.calls).toHaveLength(before) // still inside the window
    await vi.advanceTimersByTimeAsync(1)
    expect(h.calls.slice(before)).toEqual([['b', 'c']]) // one trailing round for both
  })

  it('caps media-error re-signs per shot, then shows it as unavailable instead of looping', async () => {
    const h = harness()
    h.signer.setNeeded(['a', 'b'])
    await flush()
    const resignsOfA = () => h.calls.filter((c) => c.length === 1 && c[0] === 'a').length

    for (let i = 0; i < MAX_FORCED_PER_ID; i++) {
      h.signer.reportBroken('a')
      await vi.advanceTimersByTimeAsync(BROKEN_WINDOW_MS)
    }
    expect(resignsOfA()).toBe(MAX_FORCED_PER_ID)
    expect(h.snapshot().unavailable.has('a')).toBe(false)

    h.signer.reportBroken('a') // one too many
    await vi.advanceTimersByTimeAsync(BROKEN_WINDOW_MS)
    expect(resignsOfA()).toBe(MAX_FORCED_PER_ID)
    expect(h.snapshot().unavailable.has('a')).toBe(true)
    expect(h.snapshot().urls.a).toBeUndefined()

    // Never asked for again, not even by a refresh.
    h.signer.refresh()
    await flush()
    expect(h.calls.at(-1)).toEqual(['b'])
  })

  it('a successful load resets a shot’s error budget', async () => {
    const h = harness()
    h.signer.setNeeded(['a'])
    await flush()
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < MAX_FORCED_PER_ID; i++) {
        h.signer.reportBroken('a')
        await vi.advanceTimersByTimeAsync(BROKEN_WINDOW_MS)
      }
      h.signer.reportLoaded('a') // e.g. an expired link that loaded fine once re-signed
    }
    expect(h.snapshot().unavailable.has('a')).toBe(false)
  })
})

describe('collection signer — concurrency', () => {
  it('keeps at most a few signing requests in flight for a huge roll', async () => {
    const h = harness()
    const release: Array<() => void> = []
    h.setAnswer(
      (ids) =>
        new Promise((resolve) =>
          release.push(() => resolve(Object.fromEntries(ids.map((id) => [id, `u:${id}`])))),
        ),
    )
    const ids = Array.from({ length: 1_100 }, (_, i) => `s${i}`)
    h.signer.setNeeded(ids)
    await flush()
    expect(h.calls).toHaveLength(MAX_IN_FLIGHT)

    // Each answer frees exactly one slot.
    release.shift()!()
    await flush()
    expect(h.calls).toHaveLength(MAX_IN_FLIGHT + 1)

    while (release.length > 0) {
      release.shift()!()
      await flush()
    }
    expect(h.calls).toHaveLength(Math.ceil(1_100 / SIGN_BATCH))
    expect(h.calls.every((c) => c.length <= SIGN_BATCH)).toBe(true)
    expect(h.maxInFlight()).toBe(MAX_IN_FLIGHT)
    expect(Object.keys(h.snapshot().urls)).toHaveLength(1_100)
  })

  it('drops queued batches for a roll the couple has left', async () => {
    const h = harness()
    const release: Array<() => void> = []
    h.setAnswer(
      (ids) => new Promise((resolve) => release.push(() => resolve(Object.fromEntries(ids.map((id) => [id, 'u']))))),
    )
    h.signer.setNeeded(Array.from({ length: 300 }, (_, i) => `big${i}`)) // 10 batches, 4 start
    await flush()
    h.signer.setNeeded(['cover'])
    while (release.length > 0) {
      release.shift()!()
      await flush()
    }
    // The 4 that had started, then the cover; the 6 queued big-roll batches never went out.
    expect(h.calls).toHaveLength(MAX_IN_FLIGHT + 1)
    expect(h.calls.at(-1)).toEqual(['cover'])
  })

  it('dispose stops every timer and request', async () => {
    const h = harness()
    h.setAnswer(async () => ({}))
    h.signer.setNeeded(['a'])
    await flush()
    h.signer.reportBroken('a')
    h.signer.reportBroken('a')
    h.signer.dispose()
    const n = h.calls.length
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(h.calls).toHaveLength(n)
  })
})

describe('loading the collection', () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('ignores a result for an older event or attempt', async () => {
    let stored: KeyedLoad<string> | null = null
    const set = (u: KeyedLoad<string>) => (stored = u)
    const first = deferred<string>()
    const k0 = loadKey('e1', 0)
    runLoad(k0, () => first.promise, set)
    first.reject(new Error('offline'))
    await flush()
    expect(loadFor(stored, k0)).toEqual({ status: 'error' })

    // "Try again": the old error is not shown for the new attempt — it's loading, then ready.
    const k1 = loadKey('e1', 1)
    expect(loadFor(stored, k1)).toEqual({ status: 'loading' })
    const second = deferred<string>()
    runLoad(k1, () => second.promise, set)
    expect(loadFor(stored, k1)).toEqual({ status: 'loading' })
    second.resolve('rolls')
    await flush()
    expect(loadFor(stored, k1)).toEqual({ status: 'ready', value: 'rolls' })

    // A different event never sees e1's data.
    expect(loadFor(stored, loadKey('e2', 1))).toEqual({ status: 'loading' })
  })

  it('a cancelled load never reports, even if it finishes later', async () => {
    const updates: KeyedLoad<string>[] = []
    const slow = deferred<string>()
    const cancel = runLoad(loadKey('e1', 0), () => slow.promise, (u) => updates.push(u))
    cancel()
    slow.resolve('late')
    await flush()
    expect(updates).toEqual([])
  })
})
