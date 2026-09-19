import { useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useCamera } from '../capture/useCamera.ts'
import { capturePhoto } from '../capture/capturePhoto.ts'
import { getGuestSession, updateRemaining } from '../lib/guestSession.ts'
import Counter from '../ui/Counter.tsx'
import Shutter from '../ui/Shutter.tsx'
import './Camera.css'

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
  const session = getGuestSession(eventToken)

  const camera = useCamera()
  const videoRef = useRef<HTMLVideoElement>(null)
  const capturingRef = useRef(false) // synchronous re-entry guard (survives rapid taps)
  const photosRef = useRef(session?.photosRemaining ?? 0)
  const flashTimer = useRef<number | null>(null)
  const [photos, setPhotos] = useState(session?.photosRemaining ?? 0)
  const [clips] = useState(session?.clipsRemaining ?? 0)
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
    if (capturingRef.current || photosRef.current <= 0 || !videoRef.current || !session) return
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
      playTick()
      setFlash(true)
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlash(false), 180)
    }

    capturingRef.current = false
    setCapturing(false)
  }

  if (!session) return <Navigate to={`/j/${eventToken}`} replace />

  const rollFinished = photos <= 0

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

          {flash && <div className="camera__flash" aria-hidden="true" />}

          {rollFinished && (
            <div className="camera__finished" role="status">
              <p className="camera__finished-title">Your photo roll is finished 🎞️</p>
              <p className="camera__finished-body">That’s all 25 — nicely shot.</p>
            </div>
          )}

          {captureError && (
            <p className="camera__error" role="alert">
              {captureError}
            </p>
          )}

          <div className="camera__controls">
            <button
              type="button"
              className="camera__flip"
              onClick={camera.switchCamera}
              aria-label="Switch camera"
            >
              ⟲
            </button>
            <Shutter
              onCapture={handleCapture}
              disabled={rollFinished || !videoReady}
              busy={capturing}
            />
            <span className="camera__spacer" aria-hidden="true" />
          </div>
        </div>
      )}
    </main>
  )
}
