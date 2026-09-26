// Pure camera-window rules (Story 3.2), unit-tested from the client project
// and shared by set-window and the operator console. No runtime-specific
// imports (safe in Deno, Node and the browser).
import { isUuid } from './join-rules.ts'

/** Uploads of already-taken shots are accepted this long after the close (mirrors 0008). */
export const UPLOAD_GRACE_DAYS = 7

export type WindowAction = 'open' | 'close'

export type SetWindowRequest = { eventId: string; action: WindowAction }

export type SetWindowResult = { ok: true; value: SetWindowRequest } | { ok: false; error: 'bad_request' }

/** A set-window body: a uuid `eventId` (lowercased) and `action` 'open' | 'close'. */
export function validateSetWindowRequest(raw: unknown): SetWindowResult {
  const bad = { ok: false, error: 'bad_request' } as const
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad
  const { eventId, action } = raw as Record<string, unknown>
  if (!isUuid(eventId) || (action !== 'open' && action !== 'close')) return bad
  return { ok: true, value: { eventId: eventId.toLowerCase(), action } }
}

export type WindowFailure = { status: number; code: string; message: string }

/** operator_set_window's Postgres error → set-window's answer. */
export function mapSetWindowError(code: unknown): WindowFailure {
  if (code === 'P0002') return { status: 404, code: 'not_found', message: 'That event doesn’t exist.' }
  if (code === '22023') return { status: 400, code: 'bad_request', message: 'Invalid window action.' }
  return { status: 500, code: 'server_error', message: 'Could not change the camera window.' }
}

export type WindowPhase = 'unset' | 'scheduled' | 'open' | 'closed'

/**
 * Where the event's window stands at `now` (same rule as event_status /
 * isEventOpen): no open time → unset; before open → scheduled; after close →
 * closed; otherwise open (an unset close never closes).
 */
export function windowPhase(open: string | null, close: string | null, now: Date = new Date()): WindowPhase {
  const t = now.getTime()
  const o = open ? Date.parse(open) : NaN
  if (Number.isNaN(o)) return 'unset'
  if (t < o) return 'scheduled'
  const c = close ? Date.parse(close) : NaN
  if (!Number.isNaN(c) && t > c) return 'closed'
  return 'open'
}

/** When new uploads stop being accepted for a window closing at `close` (ISO), or null if it never closes. */
export function uploadsUntil(close: string | null): string | null {
  if (!close) return null
  const c = Date.parse(close)
  if (Number.isNaN(c)) return null
  return new Date(c + UPLOAD_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString()
}
