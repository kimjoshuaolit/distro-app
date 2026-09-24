// Deciding whether the signed-in session may open this reveal, as plain,
// node-testable logic (the useCoupleSession hook is a thin shell around it,
// like rollSession.ts is for useRoll). The database decides access; this only
// sequences the read, retries transient failures and keys results to the
// session they belong to.
import type { AccessCheckError } from '../lib/coupleAuth'
import type { Access } from './coupleGate'

// Recognized by shape so this module never loads the Supabase client.
function isAccessCheckError(err: unknown): err is AccessCheckError {
  return (
    err instanceof Error &&
    err.name === 'AccessCheckError' &&
    typeof (err as AccessCheckError).status === 'number' &&
    typeof (err as AccessCheckError).code === 'string'
  )
}

/** Waits before each automatic re-check of a transient failure (then give up). */
export const RETRY_DELAYS_MS: readonly number[] = [3_000, 6_000, 12_000, 24_000, 48_000]

export type FailureKind = 'transient' | 'permanent' | 'unauthorized'

/**
 * - transient: network / timeout (status 0), 5xx, 408, 429 → retry with backoff.
 * - unauthorized: 401 (expired or rejected JWT) → terminal; a local sign-out is fine.
 * - permanent: 42501 and any other 4xx → terminal, never retried.
 * Anything that isn't an AccessCheckError (a bug, a thrown TypeError) is treated
 * as transient; the retry cap still bounds it.
 */
export function classifyAccessError(err: unknown): FailureKind {
  if (!isAccessCheckError(err)) return 'transient'
  const { status, code } = err
  if (code === '42501') return 'permanent'
  if (status === 401) return 'unauthorized'
  if (status === 0 || status >= 500 || status === 408 || status === 429) return 'transient'
  return 'permanent'
}

/** Identity of one access question: who is asking, as which email, about which event, which manual try. */
export function accessKey(userId: string, email: string | null, eventId: string, attempt: number): string {
  return JSON.stringify([userId, email, eventId, attempt])
}

export type AccessSnapshot =
  | { status: 'checking' }
  | { status: 'retrying'; retry: number; delayMs: number } // transient failure, re-check scheduled
  | { status: 'granted' }
  | { status: 'denied' }
  | { status: 'failed'; unauthorized: boolean } // terminal until the couple taps "Try again"

export type KeyedAccess = { key: string; snapshot: AccessSnapshot }

/** Only a result for exactly the current key is ever shown; anything else is still 'checking'. */
export function accessFor(stored: KeyedAccess | null, currentKey: string | null): AccessSnapshot {
  if (!currentKey || !stored || stored.key !== currentKey) return { status: 'checking' }
  return stored.snapshot
}

/** The gate only needs to know: pending, yes, no, or stuck. */
export function toGateAccess(snapshot: AccessSnapshot): Access {
  switch (snapshot.status) {
    case 'granted':
      return 'granted'
    case 'denied':
      return 'denied'
    case 'failed':
      return 'error'
    default:
      return 'checking'
  }
}

export type AccessCheckDeps = {
  check: () => Promise<'granted' | 'denied'>
  /** Run `fn` after `ms`; returns a canceller. */
  schedule: (fn: () => void, ms: number) => () => void
  onUpdate: (next: KeyedAccess) => void
  classify?: (err: unknown) => FailureKind
  delays?: readonly number[]
}

/**
 * Ask once for `key`, retrying transient failures on the backoff schedule.
 * Every update carries `key`. Returns a canceller: after it runs, no late
 * result or timer from this run can report anything.
 */
export function runAccessCheck(key: string, deps: AccessCheckDeps): () => void {
  const classify = deps.classify ?? classifyAccessError
  const delays = deps.delays ?? RETRY_DELAYS_MS
  let cancelled = false
  let cancelTimer: (() => void) | null = null

  const attempt = (retry: number) => {
    deps.check().then(
      (outcome) => {
        if (!cancelled) deps.onUpdate({ key, snapshot: { status: outcome } })
      },
      (err: unknown) => {
        if (cancelled) return
        const kind = classify(err)
        if (kind === 'transient' && retry < delays.length) {
          const delayMs = delays[retry]
          deps.onUpdate({ key, snapshot: { status: 'retrying', retry: retry + 1, delayMs } })
          cancelTimer = deps.schedule(() => {
            cancelTimer = null
            if (!cancelled) attempt(retry + 1)
          }, delayMs)
          return
        }
        deps.onUpdate({ key, snapshot: { status: 'failed', unauthorized: kind === 'unauthorized' } })
      },
    )
  }

  attempt(0)
  return () => {
    cancelled = true
    cancelTimer?.()
    cancelTimer = null
  }
}
