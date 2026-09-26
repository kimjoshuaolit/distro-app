import { useEffect, useReducer } from 'react'
import { getMontageUrl } from '../lib/api'
import { initialMontageState, montageReducer, needsFetch } from './montageSession'

/**
 * The montage stage's state (2.3): a thin shell around montageSession.ts that
 * runs whichever link fetch the state asks for — the first load, a retry, or
 * the one re-sign after a playback error — and feeds the answer back tagged
 * with its request number, so a stale answer is ignored.
 */
export function useMontage(eventId: string) {
  const [state, dispatch] = useReducer(montageReducer, initialMontageState)
  const request = needsFetch(state)

  useEffect(() => {
    if (request === null) return
    let live = true
    getMontageUrl(eventId).then(
      ({ url, expiresIn }) => {
        if (live) dispatch({ type: 'fetched', request, url, expiresIn, now: Date.now() })
      },
      () => {
        if (live) dispatch({ type: 'fetchFailed', request })
      },
    )
    return () => {
      live = false
    }
  }, [eventId, request])

  return [state, dispatch] as const
}
