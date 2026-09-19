import './ModeToggle.css'

export type CaptureMode = 'photo' | 'video'

/** Photo / video segmented control for the camera. */
export default function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: CaptureMode
  onChange: (mode: CaptureMode) => void
  disabled?: boolean
}) {
  return (
    <div className="modetoggle" role="group" aria-label="Capture mode">
      <button
        type="button"
        className={`modetoggle__btn${mode === 'photo' ? ' is-active' : ''}`}
        onClick={() => onChange('photo')}
        disabled={disabled}
        aria-pressed={mode === 'photo'}
      >
        Photo
      </button>
      <button
        type="button"
        className={`modetoggle__btn${mode === 'video' ? ' is-active' : ''}`}
        onClick={() => onChange('video')}
        disabled={disabled}
        aria-pressed={mode === 'video'}
      >
        Video
      </button>
    </div>
  )
}
