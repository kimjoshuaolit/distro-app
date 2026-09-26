// Pure couple-tier authorization rules for issue-couple-view-urls, unit-tested
// from the client project. No runtime-specific imports (safe in Deno and Node).

export type CoupleAccessDecision = 'proceed' | 'not_couple' | 'server_error'

export type CoupleEventRead = {
  /** Did the request carry an Authorization header at all? */
  hasAuthHeader: boolean
  /** The event row read through RLS with the caller's JWT (null: not visible). */
  data: unknown
  /** The read's error, if any. */
  error: unknown
  /** HTTP status PostgREST answered the read with. */
  status: number
}

/**
 * Is the caller this event's couple? Decided only by whether their own JWT can
 * read the event through RLS (AD-3) — the 2.1 email/amr rules stay the single
 * source of truth. No header, no visible row, or a token PostgREST refuses
 * (401/403) is "not the couple"; any other failed read is a server error, so an
 * outage is never mistaken for a denial (or the reverse).
 */
export function decideCoupleAccess({ hasAuthHeader, data, error, status }: CoupleEventRead): CoupleAccessDecision {
  if (!hasAuthHeader) return 'not_couple'
  if (error) return status === 401 || status === 403 ? 'not_couple' : 'server_error'
  return data ? 'proceed' : 'not_couple'
}
