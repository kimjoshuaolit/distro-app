// Pure join rules — shared by the join-event function and unit-tested from the
// client project. No runtime-specific imports (safe in both Deno and Node/vitest).

export const MAX_NAME_LEN = 40

export type NameResult =
  | { ok: true; value: string }
  | { ok: false; error: 'invalid_name' }

/** Trim and bound a submitted first name. */
export function validateFirstName(raw: unknown): NameResult {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_name' }
  const value = raw.trim()
  if (value.length === 0 || value.length > MAX_NAME_LEN) {
    return { ok: false, error: 'invalid_name' }
  }
  return { ok: true, value }
}

/**
 * Is the event capture window open right now?
 * Open requires a set window_open in the past; window_close (if set) not yet passed.
 */
export function isEventOpen(
  windowOpen: string | null,
  windowClose: string | null,
  now: Date = new Date(),
): boolean {
  if (!windowOpen) return false
  const openAt = new Date(windowOpen).getTime()
  if (Number.isNaN(openAt) || now.getTime() < openAt) return false
  if (windowClose) {
    const closeAt = new Date(windowClose).getTime()
    if (Number.isNaN(closeAt) || now.getTime() > closeAt) return false
  }
  return true
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Shape check for a v4-style UUID token. */
export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s)
}
