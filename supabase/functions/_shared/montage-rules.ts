// Pure montage-request rules for issue-montage-url, unit-tested from the client
// project. No runtime-specific imports (safe in Deno and Node).
import { isUuid } from './join-rules.ts'

/**
 * The montage link lives 1 hour (AD-2: short-lived, but long enough for a full
 * cut with a pause or two). The player re-signs once if it lapses mid-watch.
 */
export const MONTAGE_TTL_SECONDS = 3600

export type MontageRequest = { eventId: string }

export type MontageRequestResult = { ok: true; value: MontageRequest } | { ok: false; error: 'bad_request' }

/** Validate an issue-montage-url body: a plain object with a uuid `eventId` (lowercased). */
export function validateMontageRequest(raw: unknown): MontageRequestResult {
  const bad = { ok: false, error: 'bad_request' } as const
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad
  const { eventId } = raw as Record<string, unknown>
  if (!isUuid(eventId)) return bad
  return { ok: true, value: { eventId: eventId.toLowerCase() } }
}
