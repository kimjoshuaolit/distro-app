import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCollection, issueCoupleViewUrls } from '../lib/api'
import { createViewUrlCache } from '../roll/rollSession'
import { buildCollection, idsToSign, type CoupleRoll } from './buildCollection'
import {
  createCollectionSigner,
  loadFor,
  loadKey,
  runLoad,
  type CollectionSigner,
  type KeyedLoad,
  type SigningSnapshot,
} from './collectionSigning'

const NO_ROLLS: CoupleRoll[] = []
const NOTHING_SIGNED: SigningSnapshot = { urls: {}, unavailable: new Set() }

export type CollectionStatus = 'loading' | 'ready' | 'error'

const schedule = (fn: () => void, ms: number) => {
  const t = window.setTimeout(fn, ms)
  return () => window.clearTimeout(t)
}

/**
 * The couple's collection for one event (2.2). A thin shell around
 * collectionSigning.ts: loads every roll once (a failure is a retryable error,
 * never an empty shelf), then keeps signed view URLs coming for what's on
 * screen — the covers while the shelf is open, the open roll's shots when a
 * roll is open.
 */
export function useCollection(eventId: string, openGuestId: string | null) {
  const [attempt, setAttempt] = useState(0)
  const [stored, setStored] = useState<KeyedLoad<CoupleRoll[]> | null>(null)
  const [signed, setSigned] = useState<{ eventId: string; snapshot: SigningSnapshot } | null>(null)
  const signer = useRef<CollectionSigner | null>(null)

  const key = loadKey(eventId, attempt)
  useEffect(
    () => runLoad(key, () => getCollection(eventId).then(buildCollection), setStored),
    [eventId, key],
  )

  const load = loadFor(stored, key)
  const rolls = load.status === 'ready' ? load.value : NO_ROLLS

  // One signer per event; the session JWT rides along with each signing call.
  useEffect(() => {
    const s = createCollectionSigner({
      cache: createViewUrlCache((ids) => issueCoupleViewUrls(eventId, ids), Date.now),
      schedule,
      now: Date.now,
      onChange: (snapshot) => setSigned({ eventId, snapshot }),
    })
    signer.current = s
    return () => {
      s.dispose()
      if (signer.current === s) signer.current = null
    }
  }, [eventId])

  const needed = useMemo(() => idsToSign(rolls, openGuestId), [rolls, openGuestId])
  useEffect(() => {
    signer.current?.setNeeded(needed)
  }, [needed, eventId])

  // Resume when the network or the app comes back (timers may have slept).
  useEffect(() => {
    const again = () => signer.current?.refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') again()
    }
    window.addEventListener('online', again)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', again)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  /** A cover, tile or the viewer failed to load a shot's media. */
  const reportBroken = useCallback((id: string) => signer.current?.reportBroken(id), [])
  /** A cover, tile or the viewer loaded a shot's media. */
  const reportLoaded = useCallback((id: string) => signer.current?.reportLoaded(id), [])
  /** "Try again" after the collection failed to load. */
  const retry = useCallback(() => setAttempt((a) => a + 1), [])

  const { urls, unavailable } = signed?.eventId === eventId ? signed.snapshot : NOTHING_SIGNED
  const status: CollectionStatus = load.status
  return { status, rolls, urls, unavailable, reportBroken, reportLoaded, retry }
}
