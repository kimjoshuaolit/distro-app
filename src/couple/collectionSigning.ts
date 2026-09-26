// The couple's collection as plain, node-testable orchestration (2.2); the
// useCollection hook is a thin shell around it, like accessCheck.ts is for
// useCoupleSession. Two parts:
//  - a keyed one-shot load of the collection (stale results never show);
//  - a signer that keeps the on-screen shots' signed view URLs coming:
//    batched at the function's limit, a few requests at a time, retried with
//    backoff when some are missing, refreshed before they expire, re-signed
//    (rate-limited, capped per shot) when a media element fails to load one.
import { MAX_VIEW_IDS } from '../../supabase/functions/_shared/view-rules.ts'
import { VIEW_REFRESH_MARGIN_MS, type ViewUrlCache } from '../roll/rollSession.ts'
import { chunk } from './buildCollection.ts'

// ---- Loading the collection ---------------------------------------------------

export type LoadSnapshot<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error' }
export type KeyedLoad<T> = { key: string; snapshot: LoadSnapshot<T> }

/** Identity of one load: which event, which "Try again". */
export function loadKey(eventId: string, attempt: number): string {
  return JSON.stringify([eventId, attempt])
}

/** Only a result for exactly the current key is ever shown; anything else is still loading. */
export function loadFor<T>(stored: KeyedLoad<T> | null, key: string): LoadSnapshot<T> {
  if (!stored || stored.key !== key) return { status: 'loading' }
  return stored.snapshot
}

/**
 * Load once for `key`; every update carries the key. Returns a canceller: after
 * it runs, a late result from this load can't report anything.
 */
export function runLoad<T>(key: string, load: () => Promise<T>, onUpdate: (next: KeyedLoad<T>) => void): () => void {
  let cancelled = false
  load().then(
    (value) => {
      if (!cancelled) onUpdate({ key, snapshot: { status: 'ready', value } })
    },
    () => {
      if (!cancelled) onUpdate({ key, snapshot: { status: 'error' } })
    },
  )
  return () => {
    cancelled = true
  }
}

// ---- Signing ------------------------------------------------------------------

/** issue-couple-view-urls signs at most this many ids per request. */
export const SIGN_BATCH = MAX_VIEW_IDS

/** Signing requests in flight at once — a 1,100-shot roll must not fire 37 together. */
export const MAX_IN_FLIGHT = 4

/** Waits before re-asking for ids a signing round didn't return; the last one repeats. */
export const RETRY_DELAYS_MS: readonly number[] = [5_000, 10_000, 20_000, 40_000, 60_000]

/** At most one media-error-driven re-sign per window; later errors get one trailing re-sign. */
export const BROKEN_WINDOW_MS = 15_000

/** Media-error re-signs per shot before it's shown as unavailable (a dead object can't loop). */
export const MAX_FORCED_PER_ID = 3

/** Never schedule an expiry refresh sooner than this. */
export const MIN_REFRESH_WAIT_MS = 5_000

export type SigningCache = Pick<ViewUrlCache, 'get' | 'invalidate' | 'nextExpiry'>

export type SigningSnapshot = {
  /** Latest signed URL per shot id (elements that already loaded keep theirs). */
  urls: Record<string, string>
  /** Shots that kept failing to load: shown as unavailable, no longer re-signed. */
  unavailable: ReadonlySet<string>
}

export type SignerDeps = {
  cache: SigningCache
  /** Run `fn` after `ms`; returns a canceller. */
  schedule: (fn: () => void, ms: number) => () => void
  now: () => number
  onChange: (snapshot: SigningSnapshot) => void
  batchSize?: number
  maxInFlight?: number
  retryDelays?: readonly number[]
  brokenWindowMs?: number
  maxForcedPerId?: number
  refreshMarginMs?: number
}

export type CollectionSigner = {
  /** The ids on screen now (covers on the shelf, or the open roll's frames). Signs them. */
  setNeeded: (ids: string[]) => void
  /** Re-sign what's on screen now (the network or the app came back). */
  refresh: () => void
  /** A media element failed to load this shot's URL. */
  reportBroken: (id: string) => void
  /** A media element loaded this shot: its link works, so its error budget resets. */
  reportLoaded: (id: string) => void
  dispose: () => void
}

export function createCollectionSigner(deps: SignerDeps): CollectionSigner {
  const batchSize = deps.batchSize ?? SIGN_BATCH
  const maxInFlight = deps.maxInFlight ?? MAX_IN_FLIGHT
  const retryDelays = deps.retryDelays ?? RETRY_DELAYS_MS
  const brokenWindowMs = deps.brokenWindowMs ?? BROKEN_WINDOW_MS
  const maxForced = deps.maxForcedPerId ?? MAX_FORCED_PER_ID
  const margin = deps.refreshMarginMs ?? VIEW_REFRESH_MARGIN_MS

  let disposed = false
  let needed = new Set<string>()
  const urls: Record<string, string> = {}
  const unavailable = new Set<string>()
  const missing = new Set<string>() // asked for, not returned by the last attempt
  const forced = new Map<string, number>()
  const pendingBroken = new Set<string>()
  let lastForcedAt = Number.NEGATIVE_INFINITY
  let retryStep = 0
  let activeRuns = 0

  let cancelRetry: (() => void) | null = null
  let cancelExpiry: (() => void) | null = null
  let cancelTrailing: (() => void) | null = null

  // A tiny semaphore: at most `maxInFlight` cache.get calls at once, FIFO.
  let inFlight = 0
  const waiting: Array<() => void> = []
  const acquire = (): Promise<void> => {
    if (inFlight < maxInFlight) {
      inFlight++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => waiting.push(resolve)) // the slot is handed over by release()
  }
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else inFlight--
  }

  const wanted = (id: string) => needed.has(id) && !unavailable.has(id)
  const emit = () => deps.onChange({ urls: { ...urls }, unavailable: new Set(unavailable) })

  const clearFollowUps = () => {
    cancelRetry?.()
    cancelExpiry?.()
    cancelRetry = cancelExpiry = null
  }

  /** Once no round is running: retry what's missing (backoff), refresh before expiry. */
  const planFollowUps = () => {
    if (disposed || activeRuns > 0) return
    clearFollowUps()

    const retryIds = [...missing].filter(wanted)
    if (retryIds.length > 0) {
      const delay = retryDelays[Math.min(retryStep, retryDelays.length - 1)]
      retryStep++
      cancelRetry = deps.schedule(() => {
        cancelRetry = null
        run(retryIds.filter(wanted))
      }, delay)
    } else {
      retryStep = 0
    }

    // Only links still on screen (and actually held) drive the refresh timer.
    const onScreen = [...needed].filter((id) => wanted(id) && !missing.has(id))
    const expiresAt = onScreen.length > 0 ? deps.cache.nextExpiry(onScreen) : null
    if (expiresAt !== null) {
      const wait = Math.max(MIN_REFRESH_WAIT_MS, expiresAt - margin - deps.now())
      cancelExpiry = deps.schedule(() => {
        cancelExpiry = null
        run([...needed])
      }, wait)
    }
  }

  /** One signing round for `ids`: batched, concurrency-limited; never throws. */
  const run = (ids: string[]) => {
    const want = ids.filter(wanted)
    if (disposed || want.length === 0) {
      planFollowUps()
      return
    }
    clearFollowUps()
    activeRuns++
    void Promise.all(
      chunk(want, batchSize).map(async (batch) => {
        await acquire()
        try {
          if (disposed) return
          // Anything scrolled away or given up on while queued isn't asked for.
          const live = batch.filter(wanted)
          if (live.length === 0) return
          const got = await deps.cache.get(live)
          if (disposed) return
          let changed = false
          for (const id of live) {
            const url = got[id]
            if (url === undefined) {
              missing.add(id)
            } else {
              missing.delete(id)
              if (urls[id] !== url) {
                urls[id] = url
                changed = true
              }
            }
          }
          if (changed) emit()
        } finally {
          release()
        }
      }),
    ).then(() => {
      activeRuns--
      planFollowUps()
    })
  }

  const flushBroken = () => {
    cancelTrailing = null
    if (disposed) return
    lastForcedAt = deps.now()
    const ids = [...pendingBroken].filter(wanted)
    pendingBroken.clear()
    run(ids)
  }

  return {
    setNeeded(ids) {
      if (disposed) return
      needed = new Set(ids)
      for (const id of missing) if (!needed.has(id)) missing.delete(id)
      retryStep = 0
      run(ids)
    },

    refresh() {
      if (disposed) return
      retryStep = 0
      run([...needed])
    },

    reportBroken(id) {
      if (disposed || unavailable.has(id)) return
      deps.cache.invalidate(id)
      const count = (forced.get(id) ?? 0) + 1
      forced.set(id, count)
      if (count > maxForced) {
        unavailable.add(id)
        pendingBroken.delete(id)
        missing.delete(id)
        delete urls[id]
        emit()
        return
      }
      pendingBroken.add(id)
      const wait = lastForcedAt + brokenWindowMs - deps.now()
      if (wait <= 0) flushBroken()
      else if (!cancelTrailing) cancelTrailing = deps.schedule(flushBroken, wait)
    },

    reportLoaded(id) {
      forced.delete(id)
    },

    dispose() {
      disposed = true
      clearFollowUps()
      cancelTrailing?.()
      cancelTrailing = null
      // Anyone still queued wakes, sees `disposed`, and returns without a request.
      while (waiting.length > 0) waiting.shift()?.()
    },
  }
}
