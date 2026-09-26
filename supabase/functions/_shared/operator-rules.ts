// Pure operator-tier rules for save-event (Story 3.1), unit-tested from the
// client project and shared with the console's form so both validate the same
// way. No runtime-specific imports (safe in Deno, Node and the browser).
import { isUuid } from './join-rules.ts'

export type OperatorAccessDecision = 'proceed' | 'not_operator' | 'server_error'

export type OperatorCheck = {
  /** Did the request carry an Authorization header at all? */
  hasAuthHeader: boolean
  /** What `is_operator()` answered with the caller's own JWT. */
  data: unknown
  /** The RPC's error, if any. */
  error: unknown
  /** HTTP status PostgREST answered with. */
  status: number
}

/**
 * Is the caller the operator? Decided only by the database's `is_operator()`
 * run with the caller's JWT (AD-3) — the inbox-proof rule lives there. No
 * header, a refused token (401/403) or anything but `true` is "not the
 * operator"; any other failed call is a server error, so an outage is never
 * mistaken for a denial (or the reverse).
 */
export function decideOperatorAccess({ hasAuthHeader, data, error, status }: OperatorCheck): OperatorAccessDecision {
  if (!hasAuthHeader) return 'not_operator'
  if (error) return status === 401 || status === 403 ? 'not_operator' : 'server_error'
  return data === true ? 'proceed' : 'not_operator'
}

export const MAX_COUPLE_NAMES = 80
export const MAX_COUPLE_EMAILS = 2
// Deliberately loose (Auth has the final say): one @, no spaces, a dot in the domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// An ISO-8601 timestamp with a date, a time and an explicit zone (Z or ±hh:mm).
// A zoneless time would be read in whatever zone the runtime happens to be in.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/

export type SaveEventRequest = {
  /** null creates a new event. */
  eventId: string | null
  coupleNames: string
  /** UTC ISO-8601. */
  windowOpen: string
  /** UTC ISO-8601, after windowOpen. */
  windowClose: string
  /** 0–2 lowercased, trimmed, distinct emails. */
  coupleEmails: string[]
}

export type SaveEventField = 'body' | 'eventId' | 'coupleNames' | 'window' | 'coupleEmails'

export type SaveEventResult =
  | { ok: true; value: SaveEventRequest }
  | { ok: false; error: 'bad_request'; field: SaveEventField; message: string }

export type SaveFailure = { status: number; code: string; message: string; field?: SaveEventField }

/**
 * Map operator_save_event's Postgres error code to save-event's answer:
 * unknown event (P0002) → 404; a constraint backstop (23514: names, window
 * order, the two-email cap) → 400, still the caller's input; anything else → 500.
 */
export function mapSaveError(code: unknown): SaveFailure {
  if (code === 'P0002') return { status: 404, code: 'not_found', message: 'That event doesn’t exist.', field: 'eventId' }
  if (code === '23514') return { status: 400, code: 'bad_request', message: 'Invalid event.', field: 'body' }
  return { status: 500, code: 'server_error', message: 'Could not save the event.' }
}

function toUtcIso(raw: unknown): string | null {
  if (typeof raw !== 'string' || !ISO_RE.test(raw)) return null
  const t = Date.parse(raw)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/**
 * Validate a save-event body (or the console form's values): an optional uuid
 * `eventId` (absent/null = create), couple names of 1–80 characters after
 * trimming, an open/close window with close after open, and 0–2 valid,
 * distinct couple emails (normalized). The first problem found wins.
 */
export function validateSaveEventRequest(raw: unknown): SaveEventResult {
  const bad = (field: SaveEventField, message: string) => ({ ok: false, error: 'bad_request', field, message }) as const
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('body', 'Invalid event.')
  const { eventId, coupleNames, windowOpen, windowClose, coupleEmails } = raw as Record<string, unknown>

  if (eventId !== undefined && eventId !== null && !isUuid(eventId)) return bad('eventId', 'Unknown event.')

  const names = typeof coupleNames === 'string' ? coupleNames.trim() : ''
  if (names.length === 0) return bad('coupleNames', 'Add the couple’s names.')
  if (names.length > MAX_COUPLE_NAMES) return bad('coupleNames', `Keep the names to ${MAX_COUPLE_NAMES} characters.`)

  const open = toUtcIso(windowOpen)
  const close = toUtcIso(windowClose)
  if (!open || !close) return bad('window', 'Set when the camera opens and closes.')
  if (Date.parse(close) <= Date.parse(open)) return bad('window', 'The camera has to close after it opens.')

  if (!Array.isArray(coupleEmails)) return bad('coupleEmails', 'Invalid couple emails.')
  if (coupleEmails.length > MAX_COUPLE_EMAILS) return bad('coupleEmails', 'At most two couple emails.')
  const emails: string[] = []
  for (const e of coupleEmails) {
    if (typeof e !== 'string') return bad('coupleEmails', 'Invalid couple emails.')
    const email = e.trim().toLowerCase()
    if (email.length > 254 || !EMAIL_RE.test(email)) return bad('coupleEmails', `“${e.trim()}” isn’t an email address.`)
    if (emails.includes(email)) return bad('coupleEmails', 'The two couple emails are the same.')
    emails.push(email)
  }

  return {
    ok: true,
    value: {
      eventId: typeof eventId === 'string' ? eventId.toLowerCase() : null,
      coupleNames: names,
      windowOpen: open,
      windowClose: close,
      coupleEmails: emails,
    },
  }
}
