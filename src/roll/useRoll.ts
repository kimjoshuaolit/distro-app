import { useCallback, useEffect, useRef, useState } from 'react'
import { getShotsByEvent } from '../capture/db'
import { getServerRoll, issueViewUrls } from '../lib/api'
import { buildRoll, type RollItem } from './buildRoll'
import {
  createMediaCache,
  createViewUrlCache,
  loadRoll,
  VIEW_REFRESH_MARGIN_MS,
  type ViewItem,
  type ViewUrlCache,
} from './rollSession'

export type { ViewItem } from './rollSession'

export type RollState = { status: 'loading' | 'ready'; items: ViewItem[] }

/** At most one media-error-driven reload per window, so a dead link can't spin. */
const BROKEN_RETRY_MS = 15_000

/**
 * The guest's own roll. Paints from the device first (instant, works offline),
 * then swaps in the merged device + server roll. Reloads when `refreshKey`
 * changes (the uploader's pending count), when connectivity or the app comes
 * back, and shortly before signed view URLs expire. Object URLs are reused per
 * shot, so refreshes never restart a playing clip.
 */
export function useRoll(eventId: string, deviceToken: string | null, refreshKey: unknown) {
  const [state, setState] = useState<RollState>({ status: 'loading', items: [] })
  const [tick, setTick] = useState(0)
  const media = useRef<ReturnType<typeof createMediaCache> | null>(null)
  const views = useRef<ViewUrlCache | null>(null)
  const shownOnce = useRef(false)
  const lastForcedAt = useRef(0)

  // Object-URL cache for this screen; everything is revoked when it goes away.
  useEffect(() => {
    const cache = createMediaCache({
      create: (blob) => URL.createObjectURL(blob),
      revoke: (url) => URL.revokeObjectURL(url),
    })
    media.current = cache
    return () => {
      cache.dispose()
      media.current = null
    }
  }, [])

  // Signed view URLs are per guest.
  useEffect(() => {
    views.current = deviceToken
      ? createViewUrlCache((ids) => issueViewUrls(deviceToken, ids), () => Date.now())
      : null
    return () => {
      views.current = null
    }
  }, [deviceToken])

  // Resume when the network or the app comes back.
  useEffect(() => {
    const reload = () => setTick((t) => t + 1)
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    window.addEventListener('online', reload)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', reload)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let expiryTimer: number | undefined
    const viewCache = views.current

    const commit = (items: RollItem[]) => {
      if (cancelled || !media.current) return
      shownOnce.current = true
      setState({ status: 'ready', items: media.current.resolve(items) })
    }

    void loadRoll(
      {
        readLocal: () => getShotsByEvent(eventId),
        build:
          deviceToken && viewCache
            ? (local) =>
                buildRoll(local, {
                  getServerRoll: () => getServerRoll(deviceToken),
                  issueViewUrls: (ids) => viewCache.get(ids),
                })
            : undefined,
      },
      // Later refreshes skip the device-only paint so cloud tiles don't flicker.
      { paintDeviceFirst: !shownOnce.current },
      commit,
    ).then(() => {
      if (cancelled || !viewCache) return
      const expiresAt = viewCache.nextExpiry()
      if (expiresAt === null) return
      const wait = Math.max(5_000, expiresAt - VIEW_REFRESH_MARGIN_MS - Date.now())
      expiryTimer = window.setTimeout(() => setTick((t) => t + 1), wait)
    })

    return () => {
      cancelled = true
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer)
    }
  }, [eventId, deviceToken, refreshKey, tick])

  /** A tile or the viewer failed to load a shot's media: re-fetch its link. */
  const reportBroken = useCallback((id: string) => {
    views.current?.invalidate(id)
    const now = Date.now()
    if (now - lastForcedAt.current < BROKEN_RETRY_MS) return
    lastForcedAt.current = now
    setTick((t) => t + 1)
  }, [])

  return { ...state, reportBroken }
}
