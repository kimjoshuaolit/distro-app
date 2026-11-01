import { useCallback, useEffect, useRef, useState } from 'react'
import { forgetCamera, rememberCamera, rememberedCamera, type FacingMode } from './cameraMemory.ts'

export type CameraPermission = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable'
export type { FacingMode }

/**
 * Manages the getUserMedia stream: request, switch front/back, and clean up.
 * Maps browser errors to friendly permission states for the UI. A guest who
 * already turned the camera on comes straight back to it on reload or return,
 * unless `resume` is false (a page that's about to redirect shouldn't prompt).
 */
export function useCamera(resume = true) {
  const [remembered] = useState(() => (resume ? rememberedCamera() : null))
  const [permission, setPermission] = useState<CameraPermission>(remembered ? 'requesting' : 'idle')
  const [facingMode, setFacingMode] = useState<FacingMode>(remembered ?? 'environment')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const requestingRef = useRef(false)
  // The reopen below can still be waiting on the browser's permission sheet
  // when the guest leaves, so a stream that lands late must be released.
  const mountedRef = useRef(true)

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
      if (!mountedRef.current) {
        next.getTracks().forEach((t) => t.stop())
        return
      }
      // Only tear down the previous stream once the new one is live, so a failed
      // switch leaves the current viewfinder untouched.
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = next
      setStream(next)
      setFacingMode(mode)
      setPermission('granted')
      rememberCamera(mode)
    } catch (e) {
      forgetCamera()
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

  useEffect(() => {
    mountedRef.current = true
    if (remembered) void Promise.resolve().then(() => open(remembered))
    return () => {
      mountedRef.current = false
      stop()
    }
  }, [open, remembered, stop])

  return { permission, facingMode, stream, error, start, switchCamera, stop }
}
