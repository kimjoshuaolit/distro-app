// Operator console data access (Story 3.1). Sign-in is a magic link like the
// couple's; whether a session is the operator, and what it may read, is decided
// only by the database (is_operator(), RLS). Event writes go only through the
// save-event Edge Function (AD-3).
import { supabase } from './supabase'
import { isEventId, mapOtpError, normalizeEmail, type MagicLinkResult } from './coupleAuth'
import type { SaveEventRequest } from '../../supabase/functions/_shared/operator-rules.ts'
import { toGuestRows, type GuestParticipation } from '../operator/participation'

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

/** One event's summary (no couple emails), or null when it doesn't exist (or the id is malformed). */
export async function getEventSummary(eventId: string): Promise<EventSummary | null> {
  if (!isEventId(eventId)) return null
  const { data, error, status } = await supabase
    .rpc('operator_events', { p_event_id: eventId })
    .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
  if (error) throw new OperatorReadError(status ?? 0)
  const row = Array.isArray(data) ? (data[0] as EventRow | undefined) : undefined
  return row ? toSummary(row) : null
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

/**
 * Who has joined one event and roughly how much each has shot (Story 3.3),
 * newest joiner first. Read through `operator_participation()`, which answers
 * only for the operator. A malformed id reads as no guests.
 */
export async function getParticipation(eventId: string): Promise<GuestParticipation[]> {
  if (!isEventId(eventId)) return []
  const { data, error, status } = await supabase
    .rpc('operator_participation', { p_event_id: eventId })
    .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
  if (error) throw new OperatorReadError(status ?? 0)
  return toGuestRows(data)
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

/** The typed `{ error: { code, message, field? } }` out of a functions.invoke error. */
async function functionError(error: unknown): Promise<{ code: string; message: string; field: string | null }> {
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
  return { code, message, field }
}

export class WindowError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'WindowError'
    this.code = code
  }
}

export type WindowTimes = { windowOpen: string; windowClose: string }

/**
 * Open now / Close now through set-window (Story 3.2): the server moves the
 * window's ends to its own clock and answers with the new window. Throws
 * `WindowError` (`not_operator`, `not_found`, `bad_request`, `server_error`).
 */
export async function setWindow(eventId: string, action: 'open' | 'close'): Promise<WindowTimes> {
  const { data, error } = await supabase.functions.invoke('set-window', {
    body: { eventId, action },
    timeout: FUNCTION_TIMEOUT_MS,
  })
  if (error) {
    const { code, message } = await functionError(error)
    throw new WindowError(code, message)
  }
  const d = data as { windowOpen?: unknown; windowClose?: unknown } | null
  if (typeof d?.windowOpen !== 'string' || typeof d?.windowClose !== 'string') {
    throw new WindowError('server_error', 'Unexpected response from the server.')
  }
  return { windowOpen: d.windowOpen, windowClose: d.windowClose }
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
    const { code, message, field } = await functionError(error)
    throw new SaveEventError(code, message, field)
  }
  const id = (data as { eventId?: unknown } | null)?.eventId
  if (typeof id !== 'string' || id === '') throw new SaveEventError('server_error', 'Unexpected response from the server.', null)
  return id
}
