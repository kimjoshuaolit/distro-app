// Which screen the operator console shows (Story 3.1). Pure, so it's tested
// without React; useOperatorSession feeds it. Whether a session IS the
// operator is the database's call (is_operator()) — this only maps answers.
import type { LinkError } from '../lib/coupleAuth'

export type OperatorSession = { userId: string; email: string | null }

/** The operator check for the current identity. */
export type OperatorCheck =
  | { status: 'checking' }
  | { status: 'granted' }
  | { status: 'denied' }
  | { status: 'failed'; unauthorized: boolean }

export type OperatorView =
  | { view: 'loading' }
  | { view: 'login'; linkError: LinkError | null }
  | { view: 'denied' }
  | { view: 'granted' }
  | { view: 'error' }

/**
 * - Auth not settled yet → loading.
 * - Signed out → the sign-in form (with a failed link's message, if any).
 * - Signed in → loading while checking, then granted / denied, or an error
 *   screen with retry. A rejected token (401) also shows loading: the hook
 *   signs the session out, which lands on the sign-in form.
 */
export function operatorGate(
  session: OperatorSession | null | undefined,
  check: OperatorCheck,
  linkError: LinkError | null,
): OperatorView {
  if (session === undefined) return { view: 'loading' }
  if (session === null) return { view: 'login', linkError }
  switch (check.status) {
    case 'checking':
      return { view: 'loading' }
    case 'granted':
      return { view: 'granted' }
    case 'denied':
      return { view: 'denied' }
    case 'failed':
      return check.unauthorized ? { view: 'loading' } : { view: 'error' }
  }
}

/** Classify a failed check: a rejected token (401/403 from PostgREST) signs out. */
export function isUnauthorized(status: number): boolean {
  return status === 401 || status === 403
}
