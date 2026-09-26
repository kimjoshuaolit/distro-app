import { useEffect, useState } from 'react'
import { Link, useMatch, useParams } from 'react-router-dom'
import { isValidEmail, normalizeEmail, signOut, type LinkError, type OtpFailure } from '../lib/coupleAuth'
import { listEvents, requestOperatorLink, type EventSummary } from '../lib/operatorApi'
import { useOperatorSession } from '../operator/useOperatorSession'
import { formatWindow } from '../operator/localTime'
import EventForm from '../operator/EventForm'
import TableCards from '../operator/TableCards'
import './Operator.css'

const LINK_ERROR_COPY: Record<LinkError, string> = {
  expired: 'That link has expired — send a new one.',
  invalid: 'That link didn’t work — send a new one.',
}

const SEND_ERROR_COPY: Record<OtpFailure, string> = {
  not_listed: 'That email isn’t on the operator list.',
  rate_limited: 'Give it a minute, then try again.',
  invalid_email: 'That doesn’t look like an email address.',
  failed: 'Something went sideways — give it another try in a moment.',
}

function SignOutButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  return (
    <>
      <button
        type="button"
        className="op__secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(false)
          try {
            await signOut()
          } catch {
            setError(true)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {error && (
        <p className="op__notice" role="alert">
          Couldn’t sign out — check your connection and try again.
        </p>
      )}
    </>
  )
}

function LoginForm({ linkError, announce }: { linkError: LinkError | null; announce: (t: string) => void }) {
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<'form' | 'sending' | 'sent'>('form')
  const [error, setError] = useState<string | null>(null)
  const [showLinkError, setShowLinkError] = useState(true)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (phase === 'sending') return
    setError(null)
    if (!isValidEmail(email)) {
      setError(SEND_ERROR_COPY.invalid_email)
      return
    }
    setPhase('sending')
    announce('Sending your link…')
    try {
      const result = await requestOperatorLink(email)
      if (result.ok) {
        setShowLinkError(false)
        setPhase('sent')
        announce(`Link sent to ${normalizeEmail(email)}.`)
        return
      }
      setError(SEND_ERROR_COPY[result.reason])
    } catch {
      setError(SEND_ERROR_COPY.failed)
    }
    setPhase('form')
    announce('')
  }

  if (phase === 'sent') {
    return (
      <>
        <h1 className="op__title">Check your inbox</h1>
        <p className="op__body">
          A sign-in link is on its way to <strong>{normalizeEmail(email)}</strong>.
        </p>
        <button type="button" className="op__secondary" onClick={() => setPhase('form')}>
          Use a different email
        </button>
      </>
    )
  }

  return (
    <form className="op__form" onSubmit={handleSubmit} noValidate>
      <h1 className="op__title">Operator sign-in</h1>
      <p className="op__body">We’ll email you a one-time link. No password.</p>
      {linkError && showLinkError && (
        <p className="op__notice" role="alert">
          {LINK_ERROR_COPY[linkError]}
        </p>
      )}
      <label className="op__label" htmlFor="operatorEmail">
        Email
      </label>
      <input
        id="operatorEmail"
        className="op__input"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'operatorEmailError' : undefined}
      />
      {error && (
        <p id="operatorEmailError" className="op__field-error" role="alert">
          {error}
        </p>
      )}
      <div className="op__actions">
        <button className="op__primary" type="submit" disabled={phase === 'sending'}>
          {phase === 'sending' ? 'Sending…' : 'Send my link'}
        </button>
      </div>
    </form>
  )
}

function EventList() {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'failed'; events: EventSummary[] }>({
    status: 'loading',
    events: [],
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    listEvents().then(
      (events) => live && setState({ status: 'ready', events }),
      () => live && setState({ status: 'failed', events: [] }),
    )
    return () => {
      live = false
    }
  }, [attempt])

  return (
    <>
      <div className="op__heading-row">
        <h1 className="op__title">Your events</h1>
        <Link className="op__primary" to="/operator/events/new">
          New event
        </Link>
      </div>
      {state.status === 'loading' && <p className="op__body">Loading events…</p>}
      {state.status === 'failed' && (
        <>
          <p className="op__notice" role="alert">
            Couldn’t load your events — check your connection.
          </p>
          <button
            type="button"
            className="op__secondary"
            onClick={() => {
              setState({ status: 'loading', events: [] })
              setAttempt((a) => a + 1)
            }}
          >
            Try again
          </button>
        </>
      )}
      {state.status === 'ready' && state.events.length === 0 && (
        <p className="op__body">No events yet. Create one for the wedding (and maybe a test run first).</p>
      )}
      {state.status === 'ready' && state.events.length > 0 && (
        <ul className="op__list">
          {state.events.map((e) => (
            <li key={e.id}>
              <Link className="op__event" to={`/operator/events/${e.id}`}>
                <span className="op__event-names">{e.coupleNames ?? 'Untitled event'}</span>
                <span className="op__event-window">{formatWindow(e.windowOpen, e.windowClose)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * O1 Setup — the operator console (Story 3.1) at /operator: magic-link
 * sign-in; the database decides whether this session is the operator. Then
 * the event list, and create / edit at /operator/events/new and
 * /operator/events/:eventId.
 */
export default function Operator() {
  const { gate, email, sessionEpoch, retry } = useOperatorSession()
  const { eventId = null } = useParams()
  const isNew = useMatch('/operator/events/new') !== null
  const isCards = useMatch('/operator/events/:eventId/cards') !== null
  const [status, setStatus] = useState('')

  return (
    <main className="op">
      <p className="op__sr-only" role="status" aria-live="polite">
        {status}
      </p>
      <p className="op__kicker">dispo-retro-cam · operator</p>

      {gate.view === 'loading' && <p className="op__body">Opening the console…</p>}

      {gate.view === 'login' && (
        <LoginForm key={sessionEpoch} linkError={gate.linkError} announce={setStatus} />
      )}

      {gate.view === 'denied' && (
        <>
          <h1 className="op__title">This console is for the operator</h1>
          <p className="op__body">
            {email ? (
              <>
                You’re signed in as <strong>{email}</strong>.{' '}
              </>
            ) : null}
            Sign out and use the operator email.
          </p>
          <div className="op__actions">
            <SignOutButton />
          </div>
        </>
      )}

      {gate.view === 'error' && (
        <>
          <h1 className="op__title">Couldn’t open the console</h1>
          <p className="op__notice" role="alert">
            Something’s not letting us through right now.
          </p>
          <div className="op__actions">
            <button type="button" className="op__primary" onClick={retry}>
              Try again
            </button>
            <SignOutButton />
          </div>
        </>
      )}

      {gate.view === 'granted' && (
        // Remount per identity so nothing lingers across sign-ins.
        <div key={sessionEpoch}>
          {isCards && eventId ? (
            <TableCards eventId={eventId} />
          ) : isNew || eventId ? (
            <EventForm eventId={isNew ? null : eventId} announce={setStatus} />
          ) : (
            <EventList />
          )}
          <footer className="op__footer">
            <span className="op__who">{email}</span>
            <SignOutButton />
          </footer>
        </div>
      )}
    </main>
  )
}
