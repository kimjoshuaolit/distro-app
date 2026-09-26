import { useRef, useState } from 'react'
import { formatStamp } from '../capture/retro.ts'
import './RetroPlayback.css'

type Props = {
  src: string
  capturedAt: string | null
  label: string
  onError?: () => void
  /** Optional: the clip's metadata loaded (the element is now using `src`). */
  onLoaded?: () => void
}

/**
 * Plays a clip with the FunSaver look applied at playback (AD-8): warm grade,
 * grain, vignette and a date stamp are all CSS layers over an untouched file.
 */
export default function RetroPlayback({ src, capturedAt, label, onError, onLoaded }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const stamp = capturedAt ? formatStamp(new Date(capturedAt)) : null

  function toggle() {
    const v = videoRef.current
    if (!v) return
    if (v.paused || v.ended) void v.play().catch(() => setPlaying(false))
    else v.pause()
  }

  return (
    <div className={`retro${playing ? ' is-playing' : ''}`}>
      <video
        ref={videoRef}
        className="retro__video"
        src={src}
        playsInline
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onClick={toggle}
        onError={onError}
        onLoadedMetadata={onLoaded}
        aria-label={label}
      />
      <div className="retro__grain" aria-hidden="true" />
      <div className="retro__vignette" aria-hidden="true" />
      {stamp && (
        <span className="retro__stamp" aria-hidden="true">
          {stamp}
        </span>
      )}
      <button
        type="button"
        className={`retro__play${playing ? ' is-playing' : ''}`}
        onClick={toggle}
        aria-label={playing ? 'Pause clip' : 'Play clip'}
      >
        <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
      </button>
    </div>
  )
}
