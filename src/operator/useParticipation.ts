import { useCallback, useEffect, useRef, useState } from 'react'
import { getEventSummary, getParticipation, type EventSummary } from '../lib/operatorApi'
import { createRefresher, nextDashboard, type DashboardState, type GuestParticipation } from './participation'

export type DashboardData = { event: EventSummary; rows: GuestParticipation[] }

/**
 * The event (for its header: names + window, never the couple's emails) and
 * its guests, or null when the event doesn't exist.
 */
async function loadDashboard(eventId: string): Promise<DashboardData | null> {
  const [event, rows] = await Promise.all([getEventSummary(eventId), getParticipation(eventId)])
  return event ? { event, rows } : null
}

/**
 * The participation dashboard's data (Story 3.3) — a thin shell around
 * createRefresher (participation.ts). Loads now, every minute while the tab is
 * visible, when it's shown again, on reconnect, and on `refresh()`. A failed
 * refresh keeps the last data (marked stale).
 */
export function useParticipation(eventId: string) {
  const [state, setState] = useState<{ eventId: string; value: DashboardState<DashboardData> }>(() => ({
    eventId,
    value: { status: 'loading' },
  }))
  const [busy, setBusy] = useState(false)
  const refreshRef = useRef<() => void>(() => {})

  // A different event starts from scratch.
  if (state.eventId !== eventId) setState({ eventId, value: { status: 'loading' } })

  useEffect(() => {
    const refresher = createRefresher<DashboardData | null>({
      load: () => loadDashboard(eventId),
      onResult: (result) => {
        // An event that doesn't exist won't start existing: stop asking.
        if (result.ok && result.value === null) stop()
        // Fold only onto this event's state (never a previous event's data).
        setState((prev) => ({
          eventId,
          value: nextDashboard(prev.eventId === eventId ? prev.value : { status: 'loading' }, result),
        }))
      },
      onBusy: setBusy,
      every: (fn, ms) => {
        const t = window.setInterval(fn, ms)
        return () => window.clearInterval(t)
      },
      isVisible: () => document.visibilityState === 'visible',
    })
    refreshRef.current = refresher.refresh
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresher.refresh()
    }
    function stop() {
      refresher.stop()
      refreshRef.current = () => {}
      window.removeEventListener('online', refresher.refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
    refresher.start()
    window.addEventListener('online', refresher.refresh)
    document.addEventListener('visibilitychange', onVisible)
    return stop
  }, [eventId])

  const refresh = useCallback(() => refreshRef.current(), [])
  const value: DashboardState<DashboardData> = state.eventId === eventId ? state.value : { status: 'loading' }
  return { state: value, busy, refresh }
}
