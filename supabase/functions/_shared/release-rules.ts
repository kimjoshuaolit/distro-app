// Pure release-request rules for set-release, unit-tested from the client
// project. No runtime-specific imports (safe in Deno and Node).
import { isUuid } from './join-rules.ts'

export type ReleaseRequest = { eventId: string; released: boolean }

export type ReleaseRequestResult = { ok: true; value: ReleaseRequest } | { ok: false; error: 'bad_request' }

/**
 * Validate a set-release body: a plain object with a uuid `eventId`
 * (lowercased) and an explicit boolean `released`. Never a toggle — a repeated
 * or double-tapped request lands on the same value instead of flipping back.
 */
export function validateReleaseRequest(raw: unknown): ReleaseRequestResult {
  const bad = { ok: false, error: 'bad_request' } as const
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad
  const { eventId, released } = raw as Record<string, unknown>
  if (!isUuid(eventId) || typeof released !== 'boolean') return bad
  return { ok: true, value: { eventId: eventId.toLowerCase(), released } }
}
