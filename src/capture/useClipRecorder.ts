import { useCallback, useEffect, useRef, useState } from 'react'
import { pickClipMimeType } from './mediaSupport.ts'

const MAX_MS = 10_000 // hard 10s cap (FR6)

/**
 * Records a short clip from a video MediaStream. Grabs the mic on-demand at
 * start (video-only if denied), hard-caps at 10s, and hands the finished blob
 * to `onComplete` — where the caller stores it durably before counting it.
 */
export function useClipRecorder(stream: MediaStream | null) {
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const micTrackRef = useRef<MediaStreamTrack | null>(null)
  const onCompleteRef = useRef<((blob: Blob) => void) | null>(null)
  const autoStopRef = useRef<number | null>(null)
  const tickRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  // Synchronous in-flight guard: `recorderRef` isn't set until after the async
  // mic prompt, so a rapid double-tap would otherwise start two recorders.
  const startingRef = useRef(false)
  // Tracks liveness across the mic-prompt await so we can abort (and release a
  // just-acquired mic) if the component unmounts mid-prompt.
  const mountedRef = useRef(true)

  const supported = typeof MediaRecorder !== 'undefined' && pickClipMimeType() !== null

  const clearTimers = () => {
    if (autoStopRef.current) window.clearTimeout(autoStopRef.current)
    if (tickRef.current) window.clearInterval(tickRef.current)
    autoStopRef.current = null
    tickRef.current = null
  }

  const stop = useCallback(() => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
    clearTimers()
  }, [])

  const start = useCallback(
    async (onComplete: (blob: Blob) => void) => {
      if (!stream || recorderRef.current || startingRef.current) return
      startingRef.current = true
      setError(null)
      const mimeType = pickClipMimeType()
      if (!mimeType) {
        setError('Video recording isn’t supported on this browser.')
        startingRef.current = false
        return
      }

      // On-demand mic; fall back to a silent clip rather than blocking capture.
      let recordStream = new MediaStream(stream.getVideoTracks())
      let micTrack: MediaStreamTrack | null
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
        micTrack = mic.getAudioTracks()[0] ?? null
        recordStream = new MediaStream([...stream.getVideoTracks(), ...mic.getAudioTracks()])
      } catch {
        micTrack = null
      }

      // Unmounted while the permission sheet was up — release the mic and bail
      // so it never stays hot on a page the guest already left.
      if (!mountedRef.current) {
        micTrack?.stop()
        startingRef.current = false
        return
      }
      micTrackRef.current = micTrack

      let rec: MediaRecorder
      try {
        rec = new MediaRecorder(recordStream, { mimeType })
      } catch {
        micTrackRef.current?.stop()
        micTrackRef.current = null
        setError('Could not start recording.')
        startingRef.current = false
        return
      }

      const teardown = () => {
        clearTimers()
        micTrackRef.current?.stop()
        micTrackRef.current = null
        recorderRef.current = null
        startingRef.current = false
      }

      chunksRef.current = []
      onCompleteRef.current = onComplete
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        chunksRef.current = []
        teardown()
        if (mountedRef.current) {
          setRecording(false)
          setElapsedMs(0)
        }
        const done = onCompleteRef.current
        onCompleteRef.current = null
        // A 0-byte blob means nothing was actually recorded (e.g. an instant
        // tap-stop); don't spend one of the guest's final clips on an empty file.
        if (blob.size > 0) done?.(blob)
      }
      rec.onerror = () => {
        chunksRef.current = []
        onCompleteRef.current = null
        teardown()
        if (mountedRef.current) {
          setRecording(false)
          setElapsedMs(0)
          setError('Recording stopped unexpectedly — give it another go.')
        }
      }

      recorderRef.current = rec
      try {
        rec.start()
      } catch {
        onCompleteRef.current = null
        teardown()
        setError('Could not start recording.')
        return
      }
      startingRef.current = false
      startedAtRef.current = Date.now()
      setRecording(true)
      setElapsedMs(0)
      tickRef.current = window.setInterval(
        () => setElapsedMs(Date.now() - startedAtRef.current),
        100,
      )
      autoStopRef.current = window.setTimeout(() => stop(), MAX_MS)
    },
    [stream, stop],
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimers()
      const rec = recorderRef.current
      if (rec && rec.state !== 'inactive') rec.stop()
      micTrackRef.current?.stop()
    }
  }, [])

  return { recording, elapsedMs, supported, error, start, stop }
}
