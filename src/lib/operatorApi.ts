// Operator console data access (Story 3.1). Sign-in is a magic link like the
// couple's; whether a session is the operator, and what it may read, is decided
// only by the database (is_operator(), RLS). Event writes go only through the
// save-event Edge Function (AD-3).
import { supabase } from './supabase'
import { isEventId, mapOtpError, normalizeEmail, type MagicLinkResult } from './coupleAuth'
import type { SaveEventRequest } from '../../supabase/functions/_shared/operator-rules.ts'

const READ_TIMEOUT_MS = 15_000
const FUNCTION_TIMEOUT_MS = 20_000

/**
 * Email a sign-in link that lands back on the console. The /operator redirect
 * also picks the email's wording (see supabase/templates) — never access.
 */
export async function requestOperatorLink(
  email: string,
  origin: string = window.location.origin,
): Promise<MagicLinkResult> {
  const { error } = await supabase.auth.signInWithOtp({
    email: normalizeEmail(email),
    options: {
      emailRedirectTo: `${origin}/operator`,
      shouldCreateUser: true, // the Auth hook refuses anyone not on a list
    },
  })
  if (error) return { ok: false, reason: mapOtpError(error) }
  return { ok: true }
}

/** A failed operator read, with what's needed to decide retry vs. sign out. */
export class OperatorReadError extends Error {
  status: number // HTTP status; 0 = network failure or timeout
  constructor(status: number) {
    super('Could not reach the console.')
    this.name = 'OperatorReadError'
    this.status = status
  }
}

/** Is this session the operator? The database answers (is_operator()). */
export async function isOperator(): Promise<boolean> {
  const { data, error, status } = await supabase.rpc('is_operator').abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
  if (error) throw new OperatorReadError(status ?? 0)
  return data === true
}

export type EventSummary = {
  id: string
  coupleNames: string | null
  windowOpen: string | null
  windowClose: string | null
}

type EventRow = { id: string; couple_names: string | null; window_open: string | null; window_close: string | null }

function toSummary(row: EventRow): EventSummary {
  return { id: row.id, coupleNames: row.couple_names, windowOpen: row.window_open, windowClose: row.window_close }
}

/**
 * Every event, latest-opening first. Read through `operator_events()`, which
 * answers only for the operator — never through `events` RLS, which is the
 * couple gate (see 0007).
 */
export async function listEvents(): Promise<EventSummary[]> {
  const { data, error, status } = await supabase
    .rpc('operator_events')
    .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
  if (error) throw new OperatorReadError(status ?? 0)
  return (Array.isArray(data) ? (data as EventRow[]) : []).map(toSummary)
}

export type EventDetail = EventSummary & { coupleEmails: string[] }

/** One event plus its couple emails, or null when it doesn't exist (or the id is malformed). */
export async function getEvent(eventId: string): Promise<EventDetail | null> {
  if (!isEventId(eventId)) return null
  const [event, emails] = await Promise.all([
    supabase.rpc('operator_events', { p_event_id: eventId }).abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS)),
    supabase
      .rpc('operator_couple_emails', { p_event_id: eventId })
      .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS)),
  ])
  if (event.error) throw new OperatorReadError(event.status ?? 0)
  if (emails.error) throw new OperatorReadError(emails.status ?? 0)
  const row = Array.isArray(event.data) ? (event.data[0] as EventRow | undefined) : undefined
  if (!row) return null
  const list = Array.isArray(emails.data) ? emails.data.filter((e): e is string => typeof e === 'string') : []
  return { ...toSummary(row), coupleEmails: list }
}

export class SaveEventError extends Error {
  code: string
  /** Which form field the server blamed, if any. */
  field: string | null
  constructor(code: string, message: string, field: string | null) {
    super(message)
    this.name = 'SaveEventError'
    this.code = code
    this.field = field
  }
}

/**
 * Create (eventId null) or update an event through save-event. Resolves with
 * the saved event's id. Throws `SaveEventError` with the server's code
 * (`not_operator`, `bad_request` + field, `not_found`, `server_error`),
 * including on a timeout or a malformed response.
 */
export async function saveEvent(request: SaveEventRequest): Promise<string> {
  const { data, error } = await supabase.functions.invoke('save-event', {
    body: request,
    timeout: FUNCTION_TIMEOUT_MS,
  })
  if (error) {
    let code = 'server_error'
    let message = 'Something went wrong. Please try again.'
    let field: string | null = null
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = (await ctx.json()) as { error?: { code?: string; message?: string; field?: string } }
        if (body?.error?.code) {
          code = body.error.code
          message = body.error.message ?? message
          field = body.error.field ?? null
        }
      } catch {
        // keep defaults
      }
    }
    throw new SaveEventError(code, message, field)
  }
  const id = (data as { eventId?: unknown } | null)?.eventId
  if (typeof id !== 'string' || id === '') throw new SaveEventError('server_error', 'Unexpected response from the server.', null)
  return id
}
