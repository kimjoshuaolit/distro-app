// Participation dashboard rules (Story 3.3). Pure (no React, no DOM), so it's
// unit-tested in node; useParticipation wires it to the page.

/** One guest's row, as operator_participation (0009) reports it. */
export type GuestParticipation = {
  guestId: string
  firstName: string
  joinedAt: string
  photosSaved: number
  clipsSaved: number
  /** Reserved on the server but not uploaded yet. */
  onTheWay: number
  lastShotAt: string | null
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

/** The RPC's snake_case rows → GuestParticipation, dropping anything malformed. */
export function toGuestRows(data: unknown): GuestParticipation[] {
  if (!Array.isArray(data)) return []
  const rows: GuestParticipation[] = []
  for (const r of data) {
    if (!r || typeof r !== 'object') continue
    const v = r as Record<string, unknown>
    if (typeof v.guest_id !== 'string' || typeof v.first_name !== 'string' || !isTime(v.joined_at)) continue
    if (!isCount(v.photos_saved) || !isCount(v.clips_saved) || !isCount(v.on_the_way)) continue
    rows.push({
      guestId: v.guest_id,
      firstName: v.first_name,
      joinedAt: v.joined_at,
      photosSaved: v.photos_saved,
      clipsSaved: v.clips_saved,
      onTheWay: v.on_the_way,
      lastShotAt: isTime(v.last_shot_at) ? v.last_shot_at : null,
    })
  }
  return rows
}

export type ParticipationTotals = { guests: number; photos: number; clips: number; onTheWay: number }

export function totals(rows: GuestParticipation[]): ParticipationTotals {
  return rows.reduce(
    (t, r) => ({
      guests: t.guests + 1,
      photos: t.photos + r.photosSaved,
      clips: t.clips + r.clipsSaved,
      onTheWay: t.onTheWay + r.onTheWay,
    }),
    { guests: 0, photos: 0, clips: 0, onTheWay: 0 },
  )
}

/** "just now", "12 min ago", "2 h ago", "3 d ago" (a future time — clock skew — is "just now"). */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const minutes = Math.floor((now.getTime() - t) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

/**
 * What the dashboard shows. `stale` = the last refresh failed, so the page is
 * still showing data from `updatedAt`. `missing` = the event doesn't exist.
 */
export type DashboardState<T> =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'missing' }
  | { status: 'ready'; value: T; updatedAt: Date; stale: boolean }

/** Fold one refresh into the page (a load resolving to null = the event is gone). */
export function nextDashboard<T>(prev: DashboardState<T>, result: RefreshResult<T | null>): DashboardState<T> {
  if (result.ok) {
    if (result.value === null) return { status: 'missing' }
    return { status: 'ready', value: result.value, updatedAt: result.at, stale: false }
  }
  // A failed refresh never throws away what's on screen — data, or "not found".
  if (prev.status === 'ready') return { ...prev, stale: true }
  if (prev.status === 'missing') return prev
  return { status: 'failed' }
}

/** How often a visible dashboard refreshes (plus on load and on the Refresh button). */
export const PARTICIPATION_REFRESH_MS = 60_000

export type RefreshResult<T> = { ok: true; value: T; at: Date } | { ok: false }

export type RefresherDeps<T> = {
  load: () => Promise<T>
  onResult: (result: RefreshResult<T>) => void
  /** True while the newest request is in flight (for the Refresh button). */
  onBusy: (busy: boolean) => void
  /** Run `fn` every `ms`; returns a cancel. */
  every: (fn: () => void, ms: number) => () => void
  /** Hidden pages don't poll. */
  isVisible: () => boolean
  now?: () => Date
}

/**
 * Loads now, then every minute while visible; `refresh()` loads on demand.
 * Only the newest request's answer counts, so a slow old answer never
 * overwrites a newer one. Nothing is reported after `stop()`.
 */
export function createRefresher<T>(deps: RefresherDeps<T>) {
  const now = deps.now ?? (() => new Date())
  let latest = 0
  let stopped = false
  let cancel: (() => void) | null = null

  function refresh() {
    if (stopped) return
    const request = ++latest
    deps.onBusy(true)
    const settle = (result: RefreshResult<T>) => {
      if (stopped || request !== latest) return
      deps.onBusy(false)
      deps.onResult(result)
    }
    let pending: Promise<T>
    try {
      pending = deps.load()
    } catch {
      pending = Promise.reject(new Error('load threw'))
    }
    pending.then(
      (value) => settle({ ok: true, value, at: now() }),
      () => settle({ ok: false }),
    )
  }

  function start() {
    refresh()
    cancel = deps.every(() => {
      if (deps.isVisible()) refresh()
    }, PARTICIPATION_REFRESH_MS)
  }

  function stop() {
    stopped = true
    cancel?.()
  }

  return { start, refresh, stop }
}
