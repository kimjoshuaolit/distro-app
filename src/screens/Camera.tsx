import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useCamera } from '../capture/useCamera.ts'
import { capturePhoto } from '../capture/capturePhoto.ts'
import { useClipRecorder } from '../capture/useClipRecorder.ts'
import { saveClip } from '../capture/captureClip.ts'
import { useUploader } from '../capture/useUploader.ts'
import { getGuestSession, updateRemaining } from '../lib/guestSession.ts'
import { useEventWindow } from '../capture/useEventWindow.ts'
import Counter from '../ui/Counter.tsx'
import Shutter from '../ui/Shutter.tsx'
import RecordButton from '../ui/RecordButton.tsx'
import ModeToggle, { type CaptureMode } from '../ui/ModeToggle.tsx'
import UploadIndicator from '../ui/UploadIndicator.tsx'
import './Camera.css'

function formatElapsed(ms: number): string {
  const s = Math.min(10, Math.floor(ms / 1000))
  return `0:${String(s).padStart(2, '0')}`
}

// Best-effort shutter click. The web can't read the iOS hardware mute switch,
// so this is a nicety; the flash + counter tick are the real feedback.
function playTick() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 1100
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.09)
    osc.onended = () => ctx.close()
  } catch {
    // ignore — sound is optional
  }
}

export default function Camera() {
  const { eventToken = '' } = useParams()
  const navigate = useNavigate()
  const session = getGuestSession(eventToken)

  const camera = useCamera()
  const videoRef = useRef<HTMLVideoElement>(null)
  const capturingRef = useRef(false) // synchronous re-entry guard (survives rapid taps)
  const photosRef = useRef(session?.photosRemaining ?? 0)
  const clipsRef = useRef(session?.clipsRemaining ?? 0)
  const flashTimer = useRef<number | null>(null)
  const recorder = useClipRecorder(camera.stream)
  const uploader = useUploader(eventToken, session?.deviceToken ?? null)
  // Kim can close (or not yet have opened) the camera (Story 3.2). Only a
  // positive server answer locks it; offline never does (AD-1).
  const { lock, opensAt } = useEventWindow(eventToken)
  const locked = lock !== 'open'
  const [photos, setPhotos] = useState(session?.photosRemaining ?? 0)
  const [clips, setClips] = useState(session?.clipsRemaining ?? 0)
  const [mode, setMode] = useState<CaptureMode>('photo')
  const [capturing, setCapturing] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [flash, setFlash] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)

  useEffect(() => {
    const v = videoRef.current
    if (v && camera.stream) {
      setVideoReady(false)
      v.srcObject = camera.stream
      v.play().catch(() => {})
    }
  }, [camera.stream])

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
    },
    [],
  )

  async function handleCapture() {
    if (capturingRef.current || locked || photosRef.current <= 0 || !videoRef.current || !session) return
    capturingRef.current = true
    setCapturing(true)
    setCaptureError(null)

    let saved = false
    try {
      await capturePhoto({
        video: videoRef.current,
        eventId: eventToken,
        guestId: session.guestId,
      })
      saved = true
    } catch {
      setCaptureError('That shot didn’t save — give it another tap.')
    }

    // Spend a shot ONLY once it is durably stored (AD-1): a failed write never
    // decrements the counter or shows a phantom success.
    if (saved) {
      const next = Math.max(0, photosRef.current - 1)
      photosRef.current = next
      setPhotos(next)
      updateRemaining(eventToken, { photosRemaining: next })
      uploader.bump()
      playTick()
      setFlash(true)
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlash(false), 180)
    }

    capturingRef.current = false
    setCapturing(false)
  }

  async function handleClipComplete(blob: Blob) {
    if (!session) return
    try {
      await saveClip(blob, { eventId: eventToken, guestId: session.guestId })
    } catch (err) {
      const full = err instanceof Error && /quota/i.test(`${err.name} ${err.message}`)
      setCaptureError(
        full
          ? 'Your phone’s storage is full — free up some space to keep filming.'
          : 'That clip didn’t save — try again.',
      )
      return
    }
    // Spend a clip ONLY once it is durably stored (AD-1).
    const next = Math.max(0, clipsRef.current - 1)
    clipsRef.current = next
    setClips(next)
    updateRemaining(eventToken, { clipsRemaining: next })
    uploader.bump()
    playTick()
    setFlash(true)
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(false), 180)
  }

  function handleRecordToggle() {
    if (recorder.recording) {
      recorder.stop()
    } else if (!locked && clipsRef.current > 0 && videoReady) {
      setCaptureError(null)
      recorder.start(handleClipComplete)
    }
  }

  if (!session) return <Navigate to={`/j/${eventToken}`} replace />

  const photosFinished = photos <= 0
  const clipsFinished = clips <= 0
  const currentFinished = mode === 'photo' ? photosFinished : clipsFinished

  return (
    <main className="camera">
      {camera.permission === 'idle' && (
        <section className="camera__prompt">
          <h1 className="camera__title">Ready when you are 📸</h1>
          <p className="camera__body">
            We’ll ask to use your camera so you can shoot the day. Point, tap once — that’s your
            shot. No do-overs, just like real film.
          </p>
          <button type="button" className="camera__cta" onClick={camera.start}>
            Turn on the camera
          </button>
        </section>
      )}

      {camera.permission === 'requesting' && (
        <section className="camera__prompt">
          <p className="camera__body">Waking up the camera…</p>
        </section>
      )}

      {camera.permission === 'denied' && (
        <section className="camera__prompt">
          <h1 className="camera__title">Camera’s switched off</h1>
          <p className="camera__body">
            No worries — tap the camera icon in your browser’s address bar (or your phone’s site
            settings), allow the camera, then reload this page.
          </p>
          <button type="button" className="camera__cta" onClick={camera.start}>
            Try again
          </button>
        </section>
      )}

      {camera.permission === 'unavailable' && (
        <section className="camera__prompt">
          <h1 className="camera__title">No camera here</h1>
          <p className="camera__body">
            We couldn’t find a camera on this device. Open the link on the phone you’ll be shooting
            with.
          </p>
          {camera.error && <p className="camera__body camera__body--dim">({camera.error})</p>}
        </section>
      )}

      {camera.permission === 'granted' && (
        <div className="camera__stage">
          <div className="camera__statusbar">
            <span className="camera__name">{session.firstName}</span>
            <Counter photos={photos} clips={clips} />
          </div>

          <video
            ref={videoRef}
            className="camera__viewfinder"
            playsInline
            muted
            autoPlay
            onLoadedData={() => setVideoReady(true)}
          />

          {recorder.recording && (
            <div className="camera__rec" role="status" aria-label="Recording">
              <span className="camera__rec-dot" aria-hidden="true" />
              REC {formatElapsed(recorder.elapsedMs)}
            </div>
          )}

          {flash && <div className="camera__flash" aria-hidden="true" />}

          {locked && !recorder.recording && (
            <div className="camera__finished" role="status">
              <p className="camera__finished-title">
                {lock === 'closed' ? 'The camera’s closed 🎞️' : 'The camera isn’t open yet'}
              </p>
              <p className="camera__finished-body">
                {lock === 'closed'
                  ? 'Thanks for shooting! Any shots still uploading will finish on their own.'
                  : opensAt
                    ? `It opens ${new Date(opensAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} — keep this page handy.`
                    : 'It opens when the celebration starts — keep this page handy.'}
              </p>
            </div>
          )}

          {!locked && currentFinished && !recorder.recording && (
            <div className="camera__finished" role="status">
              <p className="camera__finished-title">
                {mode === 'photo' ? 'Your photo roll is finished 🎞️' : 'Your clips are all used 🎬'}
              </p>
              <p className="camera__finished-body">
                {mode === 'photo' ? 'That’s all 25 — nicely shot.' : 'All 5 clips captured.'}
              </p>
            </div>
          )}

          {mode === 'video' && !recorder.supported && (
            <p className="camera__error" role="alert">
              Clips aren’t supported on this browser.
            </p>
          )}
          {(captureError || recorder.error) && (
            <p className="camera__error" role="alert">
              {captureError ?? recorder.error}
            </p>
          )}

          <div className="camera__controls">
            <div className="camera__upload">
              <UploadIndicator
                state={uploader.state}
                pending={uploader.pendingCount}
                rejected={uploader.rejectedCount}
              />
            </div>
            <div className="camera__modewrap">
              <ModeToggle mode={mode} onChange={setMode} disabled={recorder.recording} />
            </div>
            <div className="camera__buttonrow">
              <button
                type="button"
                className="camera__flip"
                onClick={camera.switchCamera}
                aria-label="Switch camera"
                disabled={recorder.recording}
              >
                ⟲
              </button>
              {mode === 'photo' ? (
                <Shutter
                  onCapture={handleCapture}
                  disabled={locked || photosFinished || !videoReady}
                  busy={capturing}
                />
              ) : (
                <RecordButton
                  recording={recorder.recording}
                  disabled={(!recorder.recording && (locked || clipsFinished || !videoReady)) || !recorder.supported}
                  onToggle={handleRecordToggle}
                />
              )}
              <button
                type="button"
                className="camera__flip"
                onClick={() => navigate(`/r/${eventToken}`)}
                aria-label="My roll"
                disabled={recorder.recording}
              >
                🎞️
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
