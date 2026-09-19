import { supabase } from './supabase'
import type { GuestSession } from './guestSession'

export type EventStatus =
  | { state: 'open' }
  | { state: 'pending'; opensAt: string | null } // window hasn't started yet
  | { state: 'ended' } // window has passed
  | { state: 'invalid' } // unknown or malformed id
  | { state: 'error' } // transient failure — retryable

type EventStatusRow = {
  is_open: boolean
  opens_at: string | null
  closes_at: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Advisory window status for an event id (UX only; join-event re-checks).
 * Malformed id -> 'invalid' (no wasted round-trip). RPC/transport failure ->
 * 'error' (retryable), NOT 'invalid'. Empty result -> 'invalid' (unknown id).
 * A not-open event is split into 'pending' (not started) vs 'ended' (passed).
 */
export async function getEventStatus(eventId: string): Promise<EventStatus> {
  if (!UUID_RE.test(eventId)) return { state: 'invalid' }
  const { data, error } = await supabase.rpc('event_status', { p_event_id: eventId })
  if (error) return { state: 'error' }
  const row = (Array.isArray(data) ? data[0] : data) as EventStatusRow | undefined
  if (!row) return { state: 'invalid' }
  if (row.is_open) return { state: 'open' }
  if (row.opens_at && Date.now() < new Date(row.opens_at).getTime()) {
    return { state: 'pending', opensAt: row.opens_at }
  }
  return { state: 'ended' }
}

export class JoinError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'JoinError'
    this.code = code
  }
}

export type JoinResult = Omit<GuestSession, 'eventId'>

/** Create this guest server-side and return their identity + allotment. */
export async function joinEvent(eventId: string, firstName: string): Promise<JoinResult> {
  const { data, error } = await supabase.functions.invoke('join-event', {
    body: { eventToken: eventId, firstName },
  })

  if (error) {
    let code = 'server_error'
    let message = 'Something went wrong. Please try again.'
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = (await ctx.json()) as { error?: { code?: string; message?: string } }
        if (body?.error?.code) {
          code = body.error.code
          message = body.error.message ?? message
        }
      } catch {
        // keep defaults
      }
    }
    throw new JoinError(code, message)
  }

  if (!data) throw new JoinError('server_error', 'Empty response from the server.')
  return {
    guestId: data.guestId,
    deviceToken: data.deviceToken,
    firstName: data.firstName,
    photosRemaining: data.photosRemaining,
    clipsRemaining: data.clipsRemaining,
  }
}
