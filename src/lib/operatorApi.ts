// Operator console data access (Story 3.1). Sign-in is a magic link like the
// couple's; whether a session is the operator, and what it may read, is decided
// only by the database (is_operator(), RLS). Event writes go only through the
// save-event Edge Function (AD-3).
import { supabase } from './supabase'
import { isEventId, mapOtpError, normalizeEmail, type MagicLinkResult } from './coupleAuth'
import type { SaveEventRequest } from '../../supabase/functions/_shared/operator-rules.ts'
import { toGuestRows, type GuestParticipation } from '../operator/participation'
import type { ExportShot } from '../operator/exportPlan'
import type { Signed } from '../operator/exportRunner'

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

type ExportShotRow = { shot_id: string; guest_id: string; type: string; taken_at: string; ext: string | null }

/**
 * Every uploaded shot of one event for Download all (Story 3.4): metadata
 * only, never storage keys. Read through `operator_export_shots()` (operator
 * only), following its keyset pages (≤1000 rows each). Malformed rows are dropped.
 */
export async function listExportShots(eventId: string): Promise<ExportShot[]> {
  if (!isEventId(eventId)) return []
  const shots: ExportShot[] = []
  let after: string | null = null
  for (;;) {
    const { data, error, status }: { data: unknown; error: unknown; status: number } = await supabase
      .rpc('operator_export_shots', { p_event_id: eventId, p_after: after })
      .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
    if (error) throw new OperatorReadError(status ?? 0)
    const rows: ExportShotRow[] = Array.isArray(data) ? (data as ExportShotRow[]) : []
    const last: string | undefined = rows.at(-1)?.shot_id
    // Keep asking until an empty page: never infer the end from a page size
    // (the server's row cap may be lower than the function's limit). A page
    // that doesn't move past the last id is a server fault: stop, add nothing.
    if (rows.length === 0 || typeof last !== 'string' || last === after) return shots
    for (const r of rows) {
      if (typeof r?.shot_id !== 'string' || typeof r.guest_id !== 'string' || typeof r.taken_at !== 'string') continue
      if (r.type !== 'photo' && r.type !== 'clip') continue
      shots.push({ shotId: r.shot_id, guestId: r.guest_id, type: r.type, takenAt: r.taken_at, ext: r.ext ?? '' })
    }
    after = last
  }
}

export class ExportError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ExportError'
    this.code = code
  }
}

/**
 * 10-minute download links for up to 100 shots (and the hosted montage, when
 * asked) from issue-export-urls. Ids it couldn't sign are simply missing from
 * `urls`. Throws `ExportError` (`not_operator`, `bad_request`, `server_error`).
 */
export async function issueExportUrls(eventId: string, shotIds: string[], montage: boolean): Promise<Signed> {
  const { data, error } = await supabase.functions.invoke('issue-export-urls', {
    body: { eventId, shotIds, montage },
    timeout: FUNCTION_TIMEOUT_MS,
  })
  if (error) {
    // A token the gateway refuses (expired or revoked) never reaches the
    // function's own not_operator answer: treat it the same way.
    if ((error as { context?: Response }).context?.status === 401) {
      throw new ExportError('not_operator', 'Your sign-in has ended.')
    }
    const { code, message } = await functionError(error)
    throw new ExportError(code, message)
  }
  const d = data as { urls?: unknown; montage?: unknown } | null
  if (!d || typeof d.urls !== 'object' || d.urls === null || Array.isArray(d.urls)) {
    throw new ExportError('server_error', 'Unexpected response from the server.')
  }
  const urls: Record<string, string> = {}
  for (const [id, url] of Object.entries(d.urls as Record<string, unknown>)) {
    if (typeof url === 'string') urls[id] = url
  }
  const m = d.montage as { url?: unknown; ext?: unknown } | null | undefined
  const out: Signed = { urls }
  if (montage) {
    // null = nothing hosted. Anything else malformed is an error, never "no montage".
    if (m === null) out.montage = null
    else if (m && typeof m.url === 'string' && typeof m.ext === 'string') out.montage = { url: m.url, ext: m.ext }
    else throw new ExportError('server_error', 'Unexpected response from the server.')
  }
  return out
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
