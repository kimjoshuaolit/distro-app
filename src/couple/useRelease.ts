import { useEffect, useReducer } from 'react'
import { getRelease, setRelease } from '../lib/api'
import { initialReleaseState, releaseReducer } from './releaseState'

/**
 * The sharing switch's state (2.4): a thin shell around releaseState.ts that
 * runs whichever read or write the state asks for and feeds the answer back
 * tagged with its attempt / request number, so a stale answer is ignored.
 */
export function useRelease(eventId: string) {
  const [state, dispatch] = useReducer(releaseReducer, initialReleaseState)
  const loadAttempt = state.phase === 'loading' ? state.attempt : null
  const saveRequest = state.saving?.request ?? null
  const saveValue = state.saving?.value ?? null

  useEffect(() => {
    if (loadAttempt === null) return
    let live = true
    getRelease(eventId).then(
      (released) => {
        if (live) dispatch({ type: 'loaded', attempt: loadAttempt, released })
      },
      () => {
        if (live) dispatch({ type: 'loadFailed', attempt: loadAttempt })
      },
    )
    return () => {
      live = false
    }
  }, [eventId, loadAttempt])

  useEffect(() => {
    if (saveRequest === null || saveValue === null) return
    let live = true
    setRelease(eventId, saveValue).then(
      (released) => {
        if (live) dispatch({ type: 'saved', request: saveRequest, released })
      },
      () => {
        if (live) dispatch({ type: 'saveFailed', request: saveRequest })
      },
    )
    return () => {
      live = false
    }
  }, [eventId, saveRequest, saveValue])

  return [state, dispatch] as const
}
