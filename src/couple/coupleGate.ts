import type { LinkError } from '../lib/coupleAuth'
import type { EventStatus } from '../lib/api'

/** The signed-in couple as the reveal page needs it; undefined = not known yet. */
export type CoupleSession = { userId: string; email: string | null }

/**
 * Whether RLS lets the session read this event. 'checking' covers in flight and
 * transient-retrying; 'error' is terminal (retries exhausted or a permanent
 * failure) until the couple asks to try again.
 */
export type Access = 'checking' | 'granted' | 'denied' | 'error'

/**
 * Does the event behind this link exist?
 * - malformed: not a UUID (decided locally, nothing is requested)
 * - checking: asking the anon event_status RPC
 * - exists / missing: its answer
 * - unknown: the RPC failed transiently; carry on (access is enforced by RLS anyway)
 */
export type EventCheck = 'malformed' | 'checking' | 'exists' | 'missing' | 'unknown'

/** Map the existing advisory event-status read onto an EventCheck. */
export function eventCheckFrom(status: EventStatus): EventCheck {
  if (status.state === 'invalid') return 'missing'
  if (status.state === 'error') return 'unknown'
  return 'exists' // open, pending or ended — the event is real
}

/** Only a real (or possibly real) event is worth an access check. */
export function shouldCheckAccess(eventCheck: EventCheck): boolean {
  return eventCheck === 'exists' || eventCheck === 'unknown'
}

export type Gate =
  | { view: 'loading' }
  | { view: 'notFound' }
  | { view: 'login'; linkError: LinkError | null }
  | { view: 'denied' }
  | { view: 'granted' }
  | { view: 'error' }

export type GateView = Gate['view']

/**
 * What the reveal page shows. Pure: the database already decided access; this
 * only turns (session, access, link error, event check) into a screen.
 * - A malformed or unknown event → notFound, signed in or not (never a login
 *   form or "another couple" for a link that can't be anyone's reveal).
 * - Event or session still resolving → loading.
 * - No session → login, with the failed-link notice if the couple arrived on one.
 * - A session wins over a stale link error (an old link clicked while signed in).
 * - Access pending/retrying → loading; terminal failure → error.
 */
export function coupleGate(
  session: CoupleSession | null | undefined,
  access: Access,
  linkError: LinkError | null,
  eventCheck: EventCheck,
): Gate {
  if (eventCheck === 'malformed' || eventCheck === 'missing') return { view: 'notFound' }
  if (eventCheck === 'checking' || session === undefined) return { view: 'loading' }
  if (session === null) return { view: 'login', linkError }
  if (access === 'granted') return { view: 'granted' }
  if (access === 'denied') return { view: 'denied' }
  if (access === 'error') return { view: 'error' }
  return { view: 'loading' }
}
