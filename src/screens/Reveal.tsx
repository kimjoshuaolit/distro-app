import { useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import {
  checkCoupleEmail,
  isValidEmail,
  normalizeEmail,
  requestMagicLink,
  signOut,
  type LinkError,
  type OtpFailure,
} from '../lib/coupleAuth.ts'
import { useCoupleSession } from '../couple/useCoupleSession.ts'
import type { GateView } from '../couple/coupleGate.ts'
import { useCollection } from '../couple/useCollection.ts'
import RollShelf from '../couple/RollShelf.tsx'
import CoupleRoll from '../couple/CoupleRoll.tsx'
import './Reveal.css'

const LINK_ERROR_COPY: Record<LinkError, string> = {
  expired: 'That link has expired — send a new one.',
  invalid: 'That link didn’t work — send a new one.',
}

const SEND_ERROR_COPY: Record<OtpFailure, string> = {
  not_listed: 'That email isn’t on the list for this reveal — check the spelling or ask Kim.',
  rate_limited: 'Give it a minute, then try again.',
  invalid_email: 'That doesn’t look like an email address.',
  failed: 'Something went sideways — give it another try in a moment.',
}

/** What the single polite status region says for each screen (errors use role="alert"). */
const VIEW_STATUS: Record<GateView, string> = {
  loading: 'Opening your reveal…',
  notFound: 'This reveal link doesn’t look right.',
  login: '',
  denied: 'This reveal belongs to another couple.',
  granted: 'You’re signed in.',
  error: '',
}

function Kicker() {
  return <p className="reveal__kicker">Your wedding · developed</p>
}

function SignOutButton({ onError }: { onError: (message: string | null) => void }) {
  const [busy, setBusy] = useState(false)
  async function handle() {
    setBusy(true)
    onError(null)
    try {
      await signOut() // the session listener flips the page back to the login form
    } catch {
      onError('Couldn’t sign out — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" className="reveal__secondary" onClick={handle} disabled={busy}>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}

function LoginForm({
  eventId,
  linkError,
  announce,
}: {
  eventId: string
  linkError: LinkError | null
  announce: (text: string) => void
}) {
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<'form' | 'sending' | 'sent'>('form')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<OtpFailure | null>(null)
  const [showLinkError, setShowLinkError] = useState(true)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (phase === 'sending') return
    setFieldError(null)
    setSendError(null)
    if (!isValidEmail(email)) {
      setFieldError('Please enter a valid email address.')
      return
    }
    setPhase('sending')
    announce('Sending your link…')
    try {
      if (!(await checkCoupleEmail(eventId, email))) {
        setSendError('not_listed')
        setPhase('form')
        announce('')
        return
      }
      const result = await requestMagicLink(eventId, email)
      if (result.ok) {
        setShowLinkError(false)
        setPhase('sent')
        announce(`Link sent to ${normalizeEmail(email)}. Check your inbox.`)
      } else {
        if (result.reason === 'invalid_email') setFieldError(SEND_ERROR_COPY.invalid_email)
        else setSendError(result.reason)
        setPhase('form')
        announce('')
      }
    } catch {
      setSendError('failed')
      setPhase('form')
      announce('')
    }
  }

  if (phase === 'sent') {
    return (
      <>
        <h1 className="reveal__title">Check your inbox</h1>
        <p className="reveal__body">
          We sent a private link to <strong>{normalizeEmail(email)}</strong>. Open it here or on your
          phone — either works.
        </p>
        <p className="reveal__hint">It can take a minute to arrive. Peek in spam if it doesn’t.</p>
        <div className="reveal__actions">
          <button
            type="button"
            className="reveal__secondary"
            onClick={() => {
              setPhase('form')
              announce('')
            }}
          >
            Use a different email
          </button>
        </div>
      </>
    )
  }

  return (
    <form className="reveal__form" onSubmit={handleSubmit} noValidate>
      <h1 className="reveal__title">Open your reveal</h1>
      <p className="reveal__body">
        Enter the email Kim has on the list and we’ll send you a private link. No password needed.
      </p>

      {linkError && showLinkError && (
        <p className="reveal__notice" role="alert">
          {LINK_ERROR_COPY[linkError]}
        </p>
      )}

      <label className="reveal__label" htmlFor="coupleEmail">
        Your email
      </label>
      <input
        id="coupleEmail"
        className="reveal__input"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-invalid={fieldError ? 'true' : undefined}
        aria-describedby={fieldError ? 'coupleEmailError' : undefined}
      />
      {fieldError && (
        <p id="coupleEmailError" className="reveal__field-error" role="alert">
          {fieldError}
        </p>
      )}
      {sendError && (
        <p className="reveal__notice" role="alert">
          {SEND_ERROR_COPY[sendError]}
        </p>
      )}

      <button className="reveal__primary" type="submit" disabled={phase === 'sending'}>
        {phase === 'sending' ? 'Sending…' : 'Send my link'}
      </button>
    </form>
  )
}

/**
 * The signed-in view (2.2): the roll shelf at /reveal/:eventId, or one guest's
 * roll at /reveal/:eventId/roll/:guestId. The collection loads once for both,
 * so moving between them never refetches it.
 */
function Collection({
  eventId,
  guestId,
  footer,
}: {
  eventId: string
  guestId: string | null
  footer: ReactNode
}) {
  const { status, rolls, urls, unavailable, reportBroken, reportLoaded, retry } = useCollection(eventId, guestId)

  // A roll deep link gets its own loading / error / not-here states.
  if (guestId !== null) {
    return (
      <CoupleRoll
        eventId={eventId}
        guestId={guestId}
        status={status}
        roll={rolls.find((r) => r.guestId === guestId)}
        urls={urls}
        unavailable={unavailable}
        onMediaError={reportBroken}
        onMediaLoad={reportLoaded}
        onRetry={retry}
        header={<Kicker />}
        footer={footer}
      />
    )
  }

  return (
    <>
      <Kicker />
      <h1 className="reveal__title">From your people</h1>

      {status === 'loading' && <p className="reveal__body">Developing your guests’ rolls…</p>}

      {status === 'error' && (
        <>
          <p className="reveal__notice" role="alert">
            We couldn’t bring your rolls in just now — check your connection and try again.
          </p>
          <div className="reveal__actions">
            <button type="button" className="reveal__primary reveal__primary--inline" onClick={retry}>
              Try again
            </button>
          </div>
        </>
      )}

      {status === 'ready' && rolls.length === 0 && (
        <div className="reveal__prepared">
          <p className="reveal__prepared-title">Your guests’ rolls are still developing</p>
          <p className="reveal__body">
            As your guests’ shots finish uploading, each roll will appear here under their name —
            just for the two of you.
          </p>
        </div>
      )}

      {status === 'ready' && rolls.length > 0 && (
        <>
          <p className="reveal__body">Every roll, by the guest who shot it. Open one to see it all.</p>
          <RollShelf
            eventId={eventId}
            rolls={rolls}
            urls={urls}
            unavailable={unavailable}
            onMediaError={reportBroken}
            onMediaLoad={reportLoaded}
          />
        </>
      )}

      {footer}
    </>
  )
}

/**
 * C1 Reveal at /reveal/:eventId (Story 2.1): the couple signs in with a magic
 * link; the database decides whether this session may see this event. Signed
 * in, it shows the couple's collection (2.2): the roll shelf, and each guest's
 * roll at /reveal/:eventId/roll/:guestId, under the same gate.
 */
export default function Reveal() {
  const { eventId = '', guestId = null } = useParams()
  const { gate, email, retrying, retry, sessionEpoch } = useCoupleSession(eventId)
  // Both are tied to where they happened, so they vanish when the screen or
  // the signed-in identity changes — no effect needed to clear them.
  const [signOutError, setSignOutError] = useState<{ view: GateView; message: string } | null>(null)
  const [loginStatus, setLoginStatus] = useState<{ epoch: number; text: string } | null>(null)

  const showSignOutError = (message: string | null) =>
    setSignOutError(message ? { view: gate.view, message } : null)
  const signOutMessage = signOutError?.view === gate.view ? signOutError.message : null

  const status =
    gate.view === 'login'
      ? loginStatus?.epoch === sessionEpoch
        ? loginStatus.text
        : ''
      : gate.view === 'loading' && retrying
        ? 'Still connecting — hang tight…'
        : VIEW_STATUS[gate.view]

  return (
    <main className={gate.view === 'granted' ? 'reveal reveal--wide' : 'reveal'}>
      {/* The one live region: calm progress/state changes. Errors use role="alert". */}
      <p className="reveal__sr-only" role="status" aria-live="polite">
        {status}
      </p>

      <section className="reveal__stage">
        {gate.view === 'loading' && (
          <>
            <h1 className="reveal__sr-only">Your reveal</h1>
            <p className="reveal__status" aria-hidden="true">
              {retrying ? 'Still connecting — hang tight…' : 'Opening your reveal…'}
            </p>
          </>
        )}

        {gate.view === 'notFound' && (
          <>
            <Kicker />
            <h1 className="reveal__title">This reveal link doesn’t look right</h1>
            <p className="reveal__body">
              Double-check the link you were sent, or ask Kim for a fresh one.
            </p>
          </>
        )}

        {gate.view === 'login' && (
          <>
            <Kicker />
            {/* Remount per identity so a sign-out always starts from a clean form. */}
            <LoginForm
              key={sessionEpoch}
              eventId={eventId}
              linkError={gate.linkError}
              announce={(text) => setLoginStatus({ epoch: sessionEpoch, text })}
            />
          </>
        )}

        {gate.view === 'denied' && (
          <>
            <Kicker />
            <h1 className="reveal__title">This reveal belongs to another couple</h1>
            <p className="reveal__body">
              {email ? (
                <>
                  You’re signed in as <strong>{email}</strong>.{' '}
                </>
              ) : null}
              If this is your wedding, sign out and use the email Kim has on the list.
            </p>
            <div className="reveal__actions">
              <SignOutButton onError={showSignOutError} />
            </div>
          </>
        )}

        {gate.view === 'error' && (
          <>
            <Kicker />
            <h1 className="reveal__title">We couldn’t open your reveal</h1>
            <p className="reveal__notice" role="alert">
              Something’s not letting us through right now. Try again in a moment, or sign out and
              ask for a fresh link.
            </p>
            <div className="reveal__actions">
              <button type="button" className="reveal__primary reveal__primary--inline" onClick={retry}>
                Try again
              </button>
              <SignOutButton onError={showSignOutError} />
            </div>
          </>
        )}

        {gate.view === 'granted' && (
          // Remount per identity so one couple's collection never lingers for the next.
          <Collection
            key={`${eventId}:${sessionEpoch}`}
            eventId={eventId}
            guestId={guestId}
            footer={
              <div className="reveal__actions">
                <SignOutButton onError={showSignOutError} />
              </div>
            }
          />
        )}

        {signOutMessage && (
          <p className="reveal__notice" role="alert">
            {signOutMessage}
          </p>
        )}
      </section>
    </main>
  )
}
