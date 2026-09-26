// The console edits the event window in the operator's own local time (a
// `datetime-local` input) and stores it in UTC (ISO-8601). Pure helpers.

const pad = (n: number) => String(n).padStart(2, '0')

/** A stored UTC timestamp → the `YYYY-MM-DDTHH:mm` a datetime-local input shows, in local time. '' if unset/invalid. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * A datetime-local value (local time) → UTC ISO-8601. null if empty, invalid,
 * or a local time that doesn't exist (a DST spring-forward gap) — rather than
 * silently storing an hour off from what was typed.
 */
export function localInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null
  const d = new Date(value) // no zone → parsed as local time
  if (Number.isNaN(d.getTime())) return null
  if (isoToLocalInput(d.toISOString()) !== value.slice(0, 16)) return null
  return d.toISOString()
}

/** The browser's time zone, e.g. "Asia/Manila" — shown so the window is never ambiguous. */
export function localZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local time'
  } catch {
    return 'your local time'
  }
}

/** A short human window for the event list, in local time. */
export function formatWindow(open: string | null, close: string | null, locale?: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
  if (!open || !close || Number.isNaN(Date.parse(open)) || Number.isNaN(Date.parse(close))) return 'No window set'
  return `${fmt(open)} → ${fmt(close)}`
}
