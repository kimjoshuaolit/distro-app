import { useEffect, useState } from 'react'
import { getEventStatus } from '../lib/api'
import { createWindowWatcher, lockStorageKey, OPEN_STATE, parseStoredState, type WindowState } from './eventWindow'

function readStored(eventId: string): WindowState {
  try {
    return parseStoredState(localStorage.getItem(lockStorageKey(eventId))) ?? OPEN_STATE
  } catch {
    return OPEN_STATE
  }
}

function store(eventId: string, state: WindowState) {
  try {
    localStorage.setItem(lockStorageKey(eventId), JSON.stringify(state))
  } catch {
    // storage unavailable: we just won't remember across reloads
  }
}

/**
 * The camera window as the server last reported it (Story 3.2) — a thin shell
 * around createWindowWatcher (eventWindow.ts). Starts from the last known
 * state for this event (open if none: capture never waits on a check), checks
 * now, every minute while visible, when the page is shown again, and when the
 * phone reconnects.
 */
export function useEventWindow(eventId: string): WindowState {
  const [state, setState] = useState<{ eventId: string; value: WindowState }>(() => ({
    eventId,
    value: readStored(eventId),
  }))
  // A different event starts from that event's remembered state.
  if (state.eventId !== eventId) setState({ eventId, value: readStored(eventId) })

  useEffect(() => {
    const watcher = createWindowWatcher({
      fetchStatus: () => getEventStatus(eventId),
      onChange: (value) => {
        store(eventId, value)
        setState({ eventId, value })
      },
      initial: readStored(eventId),
      every: (fn, ms) => {
        const t = window.setInterval(fn, ms)
        return () => window.clearInterval(t)
      },
      isVisible: () => document.visibilityState === 'visible',
    })
    const onVisible = () => {
      if (document.visibilityState === 'visible') watcher.check()
    }
    const stop = watcher.start()
    window.addEventListener('online', watcher.check)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop()
      window.removeEventListener('online', watcher.check)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [eventId])

  return state.eventId === eventId ? state.value : readStored(eventId)
}
