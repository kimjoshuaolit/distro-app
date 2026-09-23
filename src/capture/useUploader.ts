import { useCallback, useEffect, useRef, useState } from 'react'
import { countRejected, getPendingUploads, markRejected, markUploaded } from './db'
import { confirmUpload, issueUploadUrl, putToR2 } from '../lib/api'
import { drainOnce, type UploadDeps } from './uploadQueue'
import { createUploadRunner, type RunnerSnapshot, type RunnerState } from './uploadRunner'

export type UploaderState = RunnerState

const uploadDeps: UploadDeps = { issueUploadUrl, putToR2, confirmUpload, markUploaded, markRejected }

/**
 * Background upload driver (AD-1: never blocks capture). Wires the pure upload
 * runner to the browser: drains on mount, after each capture (`bump`), when
 * connectivity returns, and when the guest brings the app back to the
 * foreground (mobile browsers freeze timers while the phone is locked).
 */
export function useUploader(eventId: string, deviceToken: string | null) {
  const [snap, setSnap] = useState<RunnerSnapshot>({ state: 'checking', pending: 0, rejected: 0 })
  const runnerRef = useRef<ReturnType<typeof createUploadRunner> | null>(null)

  useEffect(() => {
    if (!deviceToken) return
    const runner = createUploadRunner({
      getPending: () => getPendingUploads(eventId),
      countRejected: () => countRejected(eventId),
      drain: (shots) => drainOnce(shots, deviceToken, uploadDeps),
      isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
      onChange: setSnap,
    })
    runnerRef.current = runner
    void runner.run()

    const onOnline = () => runner.wake()
    const onVisible = () => {
      if (document.visibilityState === 'visible') runner.wake()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      runner.dispose()
      runnerRef.current = null
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [eventId, deviceToken])

  const bump = useCallback(() => {
    void runnerRef.current?.run()
  }, [])

  return { state: snap.state, pendingCount: snap.pending, rejectedCount: snap.rejected, bump }
}
