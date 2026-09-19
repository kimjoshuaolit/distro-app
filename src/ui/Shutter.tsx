import './Shutter.css'

/** The tactile red/gold shutter. One tap = one final capture. */
export default function Shutter({
  onCapture,
  disabled,
  busy,
}: {
  onCapture: () => void
  disabled?: boolean
  busy?: boolean
}) {
  return (
    <button
      type="button"
      className="shutter"
      onClick={onCapture}
      disabled={disabled || busy}
      aria-label="Take a photo"
      aria-busy={busy || undefined}
    >
      <span className="shutter__ring" aria-hidden="true" />
    </button>
  )
}
