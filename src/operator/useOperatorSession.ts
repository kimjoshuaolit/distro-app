import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseAuthRedirectError, signOut } from '../lib/coupleAuth'
import { isOperator, OperatorReadError } from '../lib/operatorApi'
import { isUnauthorized, operatorGate, type OperatorCheck, type OperatorSession } from './operatorGate'

/** Drop the auth hash (tokens are already consumed, or an error was read). */
function clearAuthHash() {
  if (!window.location.href.includes('#')) return
  const { pathname, search } = window.location
  window.history.replaceState(window.history.state, '', `${pathname}${search}`)
}

/**
 * The operator console's session: follows Supabase Auth (initial session,
 * magic-link sign-in — including from another tab — refresh, sign-out) and
 * asks the database whether that identity is the operator. One check per
 * (user, email, manual attempt); a rejected token signs out locally.
 */
export function useOperatorSession() {
  // Read before anything clears it: a failed link redirects as `#error=…`.
  const [linkError, setLinkError] = useState(() => parseAuthRedirectError(window.location.hash))
  const [session, setSession] = useState<OperatorSession | null | undefined>(undefined)
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const [checked, setChecked] = useState<{ key: string; check: OperatorCheck } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const identity = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      const id = s ? JSON.stringify([s.user.id, s.user.email ?? null]) : null
      if (id !== identity.current) {
        identity.current = id
        setSession(s ? { userId: s.user.id, email: s.user.email ?? null } : null)
        setSessionEpoch((e) => e + 1)
      }
      if (s) setLinkError(null)
      if (event === 'INITIAL_SESSION') clearAuthHash()
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const key = session ? JSON.stringify([session.userId, session.email, attempt]) : null

  useEffect(() => {
    if (!key) return
    let live = true
    isOperator().then(
      (ok) => live && setChecked({ key, check: { status: ok ? 'granted' : 'denied' } }),
      (err: unknown) => {
        const status = err instanceof OperatorReadError ? err.status : 0
        if (live) setChecked({ key, check: { status: 'failed', unauthorized: isUnauthorized(status) } })
      },
    )
    return () => {
      live = false
    }
  }, [key])

  // Only an answer for THIS identity and attempt counts.
  const check: OperatorCheck = checked && checked.key === key ? checked.check : { status: 'checking' }

  // A rejected token signs out locally (→ the sign-in form). If even that
  // fails, show the error screen with retry rather than loading forever.
  const signOutKey = check.status === 'failed' && check.unauthorized ? key : null
  useEffect(() => {
    if (!signOutKey) return
    signOut().catch(() => setChecked({ key: signOutKey, check: { status: 'failed', unauthorized: false } }))
  }, [signOutKey])

  const retry = useCallback(() => setAttempt((a) => a + 1), [])

  return { gate: operatorGate(session, check, linkError), email: session?.email ?? null, sessionEpoch, retry }
}
