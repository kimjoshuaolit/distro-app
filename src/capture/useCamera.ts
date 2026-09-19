import { useCallback, useEffect, useRef, useState } from 'react'

export type CameraPermission = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable'
export type FacingMode = 'user' | 'environment'

/**
 * Manages the getUserMedia stream: request, switch front/back, and clean up.
 * Maps browser errors to friendly permission states for the UI.
 */
export function useCamera() {
  const [permission, setPermission] = useState<CameraPermission>('idle')
  const [facingMode, setFacingMode] = useState<FacingMode>('environment')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const requestingRef = useRef(false)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  const open = useCallback(async (mode: FacingMode) => {
    if (requestingRef.current) return // ignore concurrent requests (e.g. double-tap flip)
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission('unavailable')
      return
    }
    requestingRef.current = true
    setPermission('requesting')
    setError(null)
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode },
        audio: false,
      })
      // Only tear down the previous stream once the new one is live, so a failed
      // switch leaves the current viewfinder untouched.
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = next
      setStream(next)
      setFacingMode(mode)
      setPermission('granted')
    } catch (e) {
      const name = (e as DOMException)?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') setPermission('denied')
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setPermission('unavailable')
      else {
        setPermission('unavailable')
        setError((e as Error)?.message ?? 'Camera error')
      }
    } finally {
      requestingRef.current = false
    }
  }, [])

  const start = useCallback(() => open(facingMode), [open, facingMode])
  const switchCamera = useCallback(
    () => open(facingMode === 'user' ? 'environment' : 'user'),
    [open, facingMode],
  )

  useEffect(() => () => stop(), [stop])

  return { permission, facingMode, stream, error, start, switchCamera, stop }
}
