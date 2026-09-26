import type { UploaderState } from '../capture/useUploader.ts'
import './UploadIndicator.css'

type Props = {
  state: UploaderState
  pending: number
  rejected?: number
}

/**
 * Small, non-blocking status chip. Reassures the guest their shots are safe
 * (AD-1: capture already succeeded locally) while they upload in the background.
 * Never claims "all saved" while shots are still local or were refused.
 */
export default function UploadIndicator({ state, pending, rejected = 0 }: Props) {
  // Haven't looked at the queue yet — say nothing rather than guess.
  if (state === 'checking') return null

  let label: string
  let mod: string
  let busy = false
  if (state === 'offline') {
    label = 'Offline — your shots are safe'
    mod = 'uploadind--offline'
  } else if (state === 'error') {
    label = `Saving paused — retrying (${pending} left)`
    mod = 'uploadind--error'
  } else if (pending > 0) {
    // 'uploading', or 'idle' with shots waiting on a retry pass
    label = `Saving… ${pending} left`
    mod = 'uploadind--busy'
    busy = true
  } else if (rejected > 0) {
    // Over the 25/5 cap, or uploads for the event had closed (3.2); My Roll
    // says which for each shot.
    label = `${rejected} couldn’t be saved`
    mod = 'uploadind--error'
  } else {
    label = 'All saved'
    mod = 'uploadind--done'
  }

  return (
    <div className={`uploadind ${mod}`} role="status" aria-live="polite">
      {busy && <span className="uploadind__dot" aria-hidden="true" />}
      {mod === 'uploadind--done' && (
        <span className="uploadind__check" aria-hidden="true">
          ✓
        </span>
      )}
      {label}
    </div>
  )
}
