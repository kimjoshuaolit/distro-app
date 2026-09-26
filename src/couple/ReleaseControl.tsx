import { useRelease } from './useRelease'
import { shownReleased } from './releaseState'
import './ReleaseControl.css'

const COPY = {
  private: 'Private — only the two of you can see this collection.',
  shared: 'Marked okay to share. Nothing is public yet — Kim will check with you before any sharing opens.',
}

/**
 * The couple's sharing switch (2.4, FR15), beneath the shelf. Private by
 * default; flipping it saves right away through set-release and goes back if
 * the save fails. Public sharing is deferred, so "on" exposes nothing yet.
 */
export default function ReleaseControl({ eventId }: { eventId: string }) {
  const [state, dispatch] = useRelease(eventId)
  const on = shownReleased(state)
  const saving = state.saving !== null

  return (
    <section className="release" aria-labelledby="releaseHeading">
      <h2 id="releaseHeading" className="release__heading">
        Sharing
      </h2>

      {state.phase === 'loading' && <p className="release__text">Checking your sharing setting…</p>}

      {state.phase === 'failed' && (
        <>
          <p className="release__text" role="alert">
            Couldn’t load your sharing setting — your collection is still private.
          </p>
          <button type="button" className="reveal__secondary" onClick={() => dispatch({ type: 'retry' })}>
            Try again
          </button>
        </>
      )}

      {state.phase === 'ready' && (
        <>
          <div className="release__row">
            <span id="releaseLabel" className="release__label">
              Okay to share
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-labelledby="releaseLabel"
              aria-describedby="releaseText"
              aria-busy={saving || undefined}
              // Not `disabled`: that would drop keyboard focus mid-save. The
              // reducer already ignores a tap while a save is in flight.
              aria-disabled={saving || undefined}
              className={on ? 'release__switch release__switch--on' : 'release__switch'}
              onClick={() => dispatch({ type: 'toggle' })}
            >
              <span className="release__thumb" aria-hidden="true" />
            </button>
          </div>
          <p id="releaseText" className="release__text">
            {saving ? 'Saving…' : on ? COPY.shared : COPY.private}
          </p>
          {state.saveFailed && (
            <p className="reveal__notice" role="alert">
              That didn’t save — check your connection and try again.
            </p>
          )}
        </>
      )}
    </section>
  )
}
