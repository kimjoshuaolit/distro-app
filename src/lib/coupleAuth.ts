// Couple sign-in (Story 2.1): passwordless magic links to the couple's own
// inboxes. These helpers only talk to Supabase; every authorization decision
// is made by the database (the Auth hook + RLS), never here (AD-3).
import { supabase } from './supabase'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Deliberately loose: one @, no spaces, a dot in the domain. Auth has the final say.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Emails are compared lowercased and trimmed everywhere (DB included). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isValidEmail(raw: string): boolean {
  const email = normalizeEmail(raw)
  return email.length <= 254 && EMAIL_RE.test(email)
}

/** Why a magic link that brought the couple here didn't sign them in. */
export type LinkError = 'expired' | 'invalid'

/**
 * Auth redirects a failed link back as `#error=…&error_code=…`. A used link and
 * an expired one both arrive as `otp_expired`; anything else is `invalid`.
 * No error params → null.
 */
export function parseAuthRedirectError(hash: string): LinkError | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  if (!params.has('error') && !params.has('error_code') && !params.has('error_description')) return null
  return params.get('error_code') === 'otp_expired' ? 'expired' : 'invalid'
}

export type OtpFailure = 'rate_limited' | 'not_listed' | 'invalid_email' | 'failed'

/** Map a Supabase Auth error from `signInWithOtp` to what the couple sees. */
export function mapOtpError(error: { status?: number; code?: string } | null | undefined): OtpFailure {
  if (!error) return 'failed'
  if (
    error.status === 429 ||
    error.code === 'over_email_send_rate_limit' ||
    error.code === 'over_request_rate_limit'
  ) {
    return 'rate_limited'
  }
  // The before_user_created hook refuses unlisted emails with a 403.
  if (error.status === 403) return 'not_listed'
  if (error.code === 'email_address_invalid' || error.code === 'validation_failed') return 'invalid_email'
  return 'failed'
}

/**
 * Advisory: is this email one of this event's couple? Powers the plain
 * "not on the list" message before any email is sent. Throws on transport
 * failure so the caller can say "try again" rather than "not on the list".
 */
export async function checkCoupleEmail(eventId: string, email: string): Promise<boolean> {
  if (!UUID_RE.test(eventId)) return false
  const { data, error } = await supabase.rpc('couple_can_sign_in', {
    p_event_id: eventId,
    p_email: normalizeEmail(email),
  })
  if (error) throw new Error('Could not check that email.')
  return data === true
}

export type MagicLinkResult = { ok: true } | { ok: false; reason: OtpFailure }

/**
 * Email a sign-in link that lands back on this event's reveal. Implicit flow,
 * so the link works on any device (see src/lib/supabase.ts).
 */
export async function requestMagicLink(
  eventId: string,
  email: string,
  origin: string = window.location.origin,
): Promise<MagicLinkResult> {
  const { error } = await supabase.auth.signInWithOtp({
    email: normalizeEmail(email),
    options: {
      emailRedirectTo: `${origin}/reveal/${eventId}`,
      shouldCreateUser: true, // the Auth hook refuses anyone not on the list
    },
  })
  if (error) return { ok: false, reason: mapOtpError(error) }
  return { ok: true }
}

export function isEventId(value: string): boolean {
  return UUID_RE.test(value)
}

/** A failed access read, with what's needed to decide retry vs. give up. */
export class AccessCheckError extends Error {
  status: number // HTTP status; 0 = network failure or timeout
  code: string // PostgREST / Postgres error code, '' if none
  constructor(status: number, code: string) {
    super('Could not open this reveal.')
    this.name = 'AccessCheckError'
    this.status = status
    this.code = code
  }
}

const ACCESS_TIMEOUT_MS = 15_000

/**
 * Can the signed-in session read this event? RLS answers: the couple's own
 * event comes back, any other (or unknown) event doesn't. Throws
 * `AccessCheckError` on failure — that is "try again" or "can't", never "denied".
 */
export async function getCoupleEvent(eventId: string): Promise<'granted' | 'denied'> {
  if (!UUID_RE.test(eventId)) return 'denied'
  const { data, error, status } = await supabase
    .from('events')
    .select('id')
    .eq('id', eventId)
    .abortSignal(AbortSignal.timeout(ACCESS_TIMEOUT_MS))
    .maybeSingle()
  if (error) throw new AccessCheckError(status ?? 0, error.code ?? '')
  return data ? 'granted' : 'denied'
}

/** Sign out on this device only (a phone and a laptop can both be signed in). */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) throw new Error('Could not sign out.')
}
