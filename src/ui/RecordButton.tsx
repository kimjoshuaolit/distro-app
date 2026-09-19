import './RecordButton.css'

/** Video record control: red disc when idle, red square when recording. */
export default function RecordButton({
  recording,
  disabled,
  onToggle,
}: {
  recording: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`record${recording ? ' record--on' : ''}`}
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={recording}
      aria-label={recording ? 'Stop recording' : 'Record a clip'}
    >
      <span className="record__inner" aria-hidden="true" />
    </button>
  )
}
