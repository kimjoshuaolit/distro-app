import { useEffect, useRef } from 'react'
import { linkLapsed } from './montageSession'
import { useMontage } from './useMontage'
import './MontageStage.css'

/**
 * The montage stage at the top of the reveal (2.3, C1): a letterboxed screen
 * with one big Play for the hand-edited hero cut, and the nudge to press it
 * before scrolling. The roll shelf sits beneath and is never locked behind it.
 *
 * - No montage hosted yet: a gentle "being prepared" note, not an error.
 * - The link fails to come: "didn't load" with a retry.
 * - The link lapses mid-watch: re-signed once, resumed where it broke
 *   (montageSession.ts owns that rule).
 *
 * No autoplay of any kind: playback starts only from the Play button, inside
 * the tap, and native controls appear from then on. No retro overlay — the
 * montage is a finished cut.
 */
export default function MontageStage({ eventId }: { eventId: string }) {
  const [state, dispatch] = useMontage(eventId)
  const videoRef = useRef<HTMLVideoElement>(null)
  const focusOnPlay = useRef(false)

  const media = state.status === 'ready' || state.status === 'playing' ? state.media : null
  const playing = state.status === 'playing'

  // A re-signed link has landed: reload the element explicitly (two signings
  // in the same second can even yield the same URL, which wouldn't reload).
  const resumePending = media?.resumePending ?? false
  const url = media?.url
  useEffect(() => {
    if (resumePending) videoRef.current?.load()
  }, [resumePending, url])

  // The Play button unmounts once playing; hand focus to the player (its
  // native controls) rather than dropping it on <body>.
  useEffect(() => {
    if (playing && focusOnPlay.current) {
      focusOnPlay.current = false
      videoRef.current?.focus()
    }
  }, [playing])

  function play() {
    // play() inside the tap itself — a user-started, unmuted playback.
    videoRef.current?.play().catch(() => {
      // A failed source also fires `error`, which drives the state; a refused
      // play leaves the native controls to try again.
    })
    focusOnPlay.current = true
    dispatch({ type: 'play' })
  }

  function onError() {
    const v = videoRef.current
    if (!v) return
    dispatch({ type: 'mediaError', at: v.currentTime, playing: !v.paused })
  }

  // Chrome retries an expired link for ~20s before it reports an error; if
  // the player stalls after the link's known expiry, re-sign right away.
  function onStall() {
    if (media && linkLapsed(media, Date.now())) onError()
  }

  function onLoadedMetadata() {
    const v = videoRef.current
    if (!v || !media?.resumePending) return
    const { resumeAt, resumePlaying } = media
    if (resumeAt > 0 && (!Number.isFinite(v.duration) || resumeAt < v.duration)) v.currentTime = resumeAt
    if (resumePlaying) v.play().catch(() => {})
    dispatch({ type: 'resumed' })
  }

  function onTimeUpdate() {
    const v = videoRef.current
    if (v && media?.resignUsed) dispatch({ type: 'progress', at: v.currentTime })
  }

  return (
    <section className="montage" aria-labelledby="montageTitle">
      <h2 id="montageTitle" className="reveal__sr-only">
        Your montage
      </h2>

      <div className={`montage__stage montage__stage--${state.status}`}>
        <div className="montage__bar" aria-hidden="true" />
        <div className="montage__screen">
          {media && (
            <video
              ref={videoRef}
              className="montage__video"
              src={media.url}
              controls={playing}
              // Nothing is fetched until Play; then let it buffer ahead.
              preload={playing ? 'auto' : 'none'}
              playsInline
              aria-label="Your wedding montage"
              onError={onError}
              onWaiting={onStall}
              onStalled={onStall}
              onLoadedMetadata={onLoadedMetadata}
              onTimeUpdate={onTimeUpdate}
            />
          )}

          {state.status === 'ready' && (
            <div className="montage__overlay">
              <button type="button" className="montage__play" onClick={play} aria-label="Play your montage">
                <span className="montage__play-icon" aria-hidden="true" />
              </button>
            </div>
          )}

          {playing && (media?.resigning || media?.resumePending) && (
            <p className="montage__note" role="status">
              Picking up where you left off…
            </p>
          )}

          {state.status === 'loading' && (
            <p className="montage__quiet" role="status">
              Threading your montage…
            </p>
          )}

          {state.status === 'none' && (
            <div className="montage__message">
              <p className="montage__message-title">Your reveal is being prepared</p>
              <p className="montage__message-body">
                Kim is putting the finishing touches on your montage — it’ll play right here. In the
                meantime, your guests’ rolls are just below.
              </p>
            </div>
          )}

          {state.status === 'failed' && (
            <div className="montage__message">
              <p className="montage__message-title" role="alert">
                The montage didn’t load
              </p>
              <p className="montage__message-body">
                Check your connection and give it another go. Your guests’ rolls are still below.
              </p>
              <button
                type="button"
                className="reveal__primary reveal__primary--inline montage__retry"
                onClick={() => dispatch({ type: 'retry' })}
              >
                Try again
              </button>
            </div>
          )}
        </div>
        <div className="montage__bar" aria-hidden="true" />
      </div>

      {state.status === 'ready' && <p className="montage__caption">Press play before you scroll.</p>}
    </section>
  )
}
