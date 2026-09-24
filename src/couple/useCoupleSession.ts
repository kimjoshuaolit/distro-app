import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getEventStatus } from '../lib/api'
import { getCoupleEvent, isEventId, parseAuthRedirectError, signOut } from '../lib/coupleAuth'
import { accessFor, accessKey, runAccessCheck, toGateAccess, type KeyedAccess } from './accessCheck'
import {
  coupleGate,
  eventCheckFrom,
  shouldCheckAccess,
  type CoupleSession,
  type EventCheck,
} from './coupleGate'

/** Drop the auth hash (tokens are already consumed, or an error was read). */
function clearAuthHash() {
  if (!window.location.href.includes('#')) return
  const { pathname, search } = window.location
  window.history.replaceState(window.history.state, '', `${pathname}${search}`)
}

const schedule = (fn: () => void, ms: number) => {
  const t = window.setTimeout(fn, ms)
  return () => window.clearTimeout(t)
}

/**
 * The couple's session for one event's reveal. Checks the link's event exists
 * (anon event_status), follows Supabase Auth (initial session, magic-link
 * sign-in — including from another tab — refresh, email change, sign-out) and
 * asks RLS whether that session can read `eventId`. Sequencing, retries and
 * keying live in accessCheck.ts; the screen mapping in coupleGate.ts.
 */
export function useCoupleSession(eventId: string) {
  // Read before anything clears it: a failed link redirects as `#error=…`.
  const [linkError, setLinkError] = useState(() => parseAuthRedirectError(window.location.hash))
  const [session, setSession] = useState<CoupleSession | null | undefined>(undefined)
  // Bumps whenever the signed-in identity changes, so per-session UI can reset.
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const [eventState, setEventState] = useState<{ id: string; check: EventCheck } | null>(null)
  const [access, setAccess] = useState<KeyedAccess | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Last identity seen from Auth; undefined until the first event.
  const identity = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      // Token refreshes keep the same identity, so nothing re-checks; a new
      // user or a changed email (USER_UPDATED) is a new identity.
      const id = s ? JSON.stringify([s.user.id, s.user.email ?? null]) : null
      if (id !== identity.current) {
        identity.current = id
        setSession(s ? { userId: s.user.id, email: s.user.email ?? null } : null)
        setSessionEpoch((e) => e + 1)
      }
      // A session supersedes a failed link; don't resurface it after sign-out.
      if (s) setLinkError(null)
      // By INITIAL_SESSION the client has consumed any tokens in the hash.
      if (event === 'INITIAL_SESSION') clearAuthHash()
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Does the link's event exist? A malformed id never leaves the browser.
  const malformed = !isEventId(eventId)
  useEffect(() => {
    if (malformed) return
    let active = true
    getEventStatus(eventId)
      .then((status) => active && setEventState({ id: eventId, check: eventCheckFrom(status) }))
      .catch(() => active && setEventState({ id: eventId, check: 'unknown' }))
    return () => {
      active = false
    }
  }, [eventId, malformed])
  const eventCheck: EventCheck = malformed
    ? 'malformed'
    : eventState?.id === eventId
      ? eventState.check
      : 'checking'

  // One access question per (user, email, event, manual attempt).
  const userId = session?.userId ?? null
  const email = session?.email ?? null
  const key = userId && shouldCheckAccess(eventCheck) ? accessKey(userId, email, eventId, attempt) : null

  useEffect(() => {
    if (!key) return
    return runAccessCheck(key, { check: () => getCoupleEvent(eventId), schedule, onUpdate: setAccess })
  }, [key, eventId, userId, email])

  const snapshot = accessFor(access, key)

  // A rejected/expired JWT (401): drop the local session; the page falls back to login.
  const signOutLocally = snapshot.status === 'failed' && snapshot.unauthorized
  useEffect(() => {
    if (signOutLocally) signOut().catch(() => {})
  }, [signOutLocally])

  /** "Try again" after a terminal failure: a new attempt is a new key. */
  const retry = useCallback(() => setAttempt((a) => a + 1), [])

  return {
    gate: coupleGate(session, toGateAccess(snapshot), linkError, eventCheck),
    email,
    retrying: snapshot.status === 'retrying',
    retry,
    sessionEpoch,
  }
}
