import { useRef, useState } from 'react'
import './RetroPlayback.css'

type Props = {
  src: string
  label: string
  onError?: () => void
  /** Optional: the clip's metadata loaded (the element is now using `src`). */
  onLoaded?: () => void
}

/** Plays a clip as recorded, with a tap-to-play button over it. */
export default function RetroPlayback({ src, label, onError, onLoaded }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

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
