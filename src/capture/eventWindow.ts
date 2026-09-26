// Does the camera lock? (Story 3.2) Only a positive answer from the server
// locks it: the window has ended, or hasn't started. Offline, a failed check or
// an unexpected answer keeps whatever we last knew — capture never waits on the
// network (AD-1). Pure (no React, no DOM), so it's unit-tested in node;
// useEventWindow wires it to the page.
import type { EventStatus } from '../lib/api'

export type CameraLock = 'open' | 'closed' | 'pending'

/** The lock, plus when a not-yet-open camera opens (for the guest's banner). */
export type WindowState = { lock: CameraLock; opensAt: string | null }

export const OPEN_STATE: WindowState = { lock: 'open', opensAt: null }

export function nextLock(previous: CameraLock, status: EventStatus): CameraLock {
  switch (status.state) {
    case 'open':
      return 'open'
    case 'ended':
      return 'closed'
    case 'pending':
      return 'pending'
    default:
      return previous // 'error' (offline, timeout) or 'invalid': no news
  }
}

/** Fold one server answer into the state (keeps a known opensAt through "no news"). */
export function nextState(previous: WindowState, status: EventStatus): WindowState {
  const lock = nextLock(previous.lock, status)
  if (status.state === 'pending') return { lock, opensAt: status.opensAt }
  return { lock, opensAt: lock === 'pending' ? previous.opensAt : null }
}

/** How often a visible camera re-checks the window (plus on return to the page and on reconnect). */
export const WINDOW_CHECK_MS = 60_000

export type WatcherDeps = {
  fetchStatus: () => Promise<EventStatus>
  onChange: (state: WindowState) => void
  initial: WindowState
  /** Run `fn` every `ms`; returns a cancel. */
  every: (fn: () => void, ms: number) => () => void
  /** Hidden pages don't poll (they re-check when shown again). */
  isVisible: () => boolean
}

/**
 * Checks the window now and then every minute while visible; `check()` is
 * also called by the page on return and on reconnect. Only the newest answer
 * counts, so a slow old "open" can never unlock a camera a newer answer closed.
 */
export function createWindowWatcher(deps: WatcherDeps) {
  let state = deps.initial
  let latest = 0
  let stopped = false

  function check() {
    if (stopped) return
    const request = ++latest
    deps.fetchStatus().then(
      (status) => {
        if (stopped || request !== latest) return
        const next = nextState(state, status)
        if (next.lock !== state.lock || next.opensAt !== state.opensAt) {
          state = next
          deps.onChange(state)
        }
      },
      () => {}, // a thrown check is "no news", like 'error'
    )
  }

  function start(): () => void {
    check()
    const cancel = deps.every(() => {
      if (deps.isVisible()) check()
    }, WINDOW_CHECK_MS)
    return () => {
      stopped = true
      cancel()
    }
  }

  return { check, start }
}

/** The last known state, remembered per event so an offline reload of a closed camera stays closed. */
export function parseStoredState(raw: string | null): WindowState | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<WindowState>
    if (v.lock !== 'open' && v.lock !== 'closed' && v.lock !== 'pending') return null
    return { lock: v.lock, opensAt: typeof v.opensAt === 'string' ? v.opensAt : null }
  } catch {
    return null
  }
}

export const lockStorageKey = (eventId: string) => `drc:window:${eventId}`
