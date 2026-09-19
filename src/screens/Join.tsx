import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getEventStatus, joinEvent, JoinError } from '../lib/api.ts'
import { getGuestSession, saveGuestSession } from '../lib/guestSession.ts'
import './Join.css'

type View =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'pending' } // event hasn't opened yet
  | { kind: 'ended' } // event window has passed
  | { kind: 'open' }
  | { kind: 'joined'; firstName: string }
  | { kind: 'error' }

export default function Join() {
  const { eventToken = '' } = useParams()
  // Resolve the synchronous "already joined" case up front, so the effect only
  // ever does the async status fetch (no setState-in-effect-body).
  const [view, setView] = useState<View>(() => {
    const existing = getGuestSession(eventToken)
    return existing ? { kind: 'joined', firstName: existing.firstName } : { kind: 'loading' }
  })
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  useEffect(() => {
    if (getGuestSession(eventToken)) return // already joined; initial state covers it
    let active = true

    getEventStatus(eventToken)
      .then((status) => {
        if (!active) return
        if (status.state === 'invalid') setView({ kind: 'invalid' })
        else if (status.state === 'error') setView({ kind: 'error' })
        else if (status.state === 'pending') setView({ kind: 'pending' })
        else if (status.state === 'ended') setView({ kind: 'ended' })
        else setView({ kind: 'open' })
      })
      .catch(() => active && setView({ kind: 'error' }))

    return () => {
      active = false
    }
  }, [eventToken])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setNameError(null)
    if (name.trim().length === 0) {
      setNameError('Please enter your first name.')
      return
    }
    setSubmitting(true)
    try {
      const result = await joinEvent(eventToken, name)
      saveGuestSession({ eventId: eventToken, ...result })
      setView({ kind: 'joined', firstName: result.firstName })
    } catch (err) {
      if (err instanceof JoinError) {
        if (err.code === 'invalid_name') setNameError(err.message)
        else if (err.code === 'event_closed') setView({ kind: 'ended' })
        else if (err.code === 'event_not_found') setView({ kind: 'invalid' })
        else setView({ kind: 'error' })
      } else {
        setView({ kind: 'error' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="join">
      <section className="join__card" aria-live="polite">
        {view.kind === 'loading' && <p className="join__status">Loading your camera…</p>}

        {view.kind === 'invalid' && (
          <>
            <h1 className="join__title">Hmm, this link isn’t working</h1>
            <p className="join__body">
              Double-check the QR code, or ask whoever’s running the camera for a fresh link.
            </p>
          </>
        )}

        {view.kind === 'pending' && (
          <>
            <h1 className="join__title">The camera isn’t open yet</h1>
            <p className="join__body">
              Hang tight — this disposable camera opens when the celebration starts.
            </p>
          </>
        )}

        {view.kind === 'ended' && (
          <>
            <h1 className="join__title">That’s a wrap 🎬</h1>
            <p className="join__body">
              This camera has closed. Thanks for being part of the day!
            </p>
          </>
        )}

        {view.kind === 'error' && (
          <>
            <h1 className="join__title">Something went sideways</h1>
            <p className="join__body">Give it another try in a moment.</p>
          </>
        )}

        {view.kind === 'joined' && (
          <>
            <h1 className="join__title">You’re in, {view.firstName}! 🎉</h1>
            <p className="join__body">
              Your roll is ready: <strong>25 photos + 5 clips</strong>, each one final.
            </p>
            <Link className="join__submit join__submit--link" to={`/c/${eventToken}`}>
              Start shooting
            </Link>
          </>
        )}

        {view.kind === 'open' && (
          <form className="join__form" onSubmit={handleSubmit} noValidate>
            <h1 className="join__title">Grab your camera 🎞️</h1>
            <p className="join__body">
              Enter your first name and shoot the wedding like a disposable camera — 25 photos and 5
              short clips, each one final.
            </p>
            <label className="join__label" htmlFor="firstName">
              First name
            </label>
            <input
              id="firstName"
              className="join__input"
              type="text"
              inputMode="text"
              autoComplete="given-name"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={nameError ? 'true' : undefined}
              aria-describedby={nameError ? 'nameError' : undefined}
              autoFocus
            />
            {nameError && (
              <p id="nameError" className="join__error" role="alert">
                {nameError}
              </p>
            )}
            <button className="join__submit" type="submit" disabled={submitting}>
              {submitting ? 'Getting your roll…' : 'Start shooting'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
