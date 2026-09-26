import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatAgo, totals, type GuestParticipation } from './participation'
import { joinUrl } from './qr'
import { useParticipation } from './useParticipation'
import { windowLine } from './windowLine'
import './Dashboard.css'

const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** A time today reads "9:41 PM"; any other day gets its date too. */
function when(iso: string, now: Date): string {
  const d = new Date(iso)
  return d.toDateString() === now.toDateString()
    ? time(d)
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function GuestRow({ guest, now }: { guest: GuestParticipation; now: Date }) {
  const shot = guest.photosSaved + guest.clipsSaved + guest.onTheWay > 0
  return (
    <li className="dash__guest">
      <p className="dash__guest-head">
        <span className="dash__name">{guest.firstName}</span>
        <span className="dash__joined">joined {when(guest.joinedAt, now)}</span>
      </p>
      {shot ? (
        <p className="dash__counts">
          {plural(guest.photosSaved, 'photo', 'photos')} · {plural(guest.clipsSaved, 'clip', 'clips')} saved
          {guest.onTheWay > 0 && <span className="dash__on-way"> · {guest.onTheWay} on the way</span>}
        </p>
      ) : (
        <p className="dash__counts dash__counts--none">No shots yet</p>
      )}
      {guest.lastShotAt && <p className="dash__last">Last shot {formatAgo(guest.lastShotAt, now)}</p>}
    </li>
  )
}

/**
 * O2 Dashboard (Story 3.3): who has joined one event and roughly how much each
 * guest has shot, newest joiner first. Fresh on load, every minute while
 * visible, and on Refresh. Story 3.4's Download all lands here too.
 */
export default function Dashboard({ eventId }: { eventId: string }) {
  const { state, busy, refresh } = useParticipation(eventId)
  const [now, setNow] = useState(() => new Date())

  // Keep "12 min ago" and the camera line honest while the page sits open.
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const back = (
    <p className="op__back">
      <Link to={`/operator/events/${eventId}`}>← Back to the event</Link>
    </p>
  )

  if (state.status === 'loading') {
    return (
      <>
        {back}
        <p className="op__body">Counting guests…</p>
      </>
    )
  }
  if (state.status === 'missing') {
    return (
      <>
        <p className="op__back">
          <Link to="/operator">← All events</Link>
        </p>
        <h1 className="op__title">Event not found</h1>
        <p className="op__body">That event doesn’t exist.</p>
      </>
    )
  }
  if (state.status === 'failed') {
    return (
      <>
        {back}
        <p className="op__notice" role="alert">
          Couldn’t load the dashboard — check your connection.
        </p>
        <button type="button" className="op__secondary" onClick={refresh} disabled={busy}>
          {busy ? 'Trying…' : 'Try again'}
        </button>
      </>
    )
  }

  const { event, rows } = state.value
  const sum = totals(rows)
  const camera = windowLine(event.windowOpen, event.windowClose, now, (iso) => when(iso, now))

  return (
    <>
      {back}
      <h1 className="op__title">{event.coupleNames ?? 'Untitled event'}</h1>
      <p className={`op__phase op__phase--${camera.phase}`}>Camera: {camera.text}</p>

      <dl className="dash__totals">
        <div className="dash__total">
          <dt>Guests</dt>
          <dd>{sum.guests}</dd>
        </div>
        <div className="dash__total">
          <dt>Photos saved</dt>
          <dd>{sum.photos}</dd>
        </div>
        <div className="dash__total">
          <dt>Clips saved</dt>
          <dd>{sum.clips}</dd>
        </div>
        <div className="dash__total">
          <dt>On the way</dt>
          <dd>{sum.onTheWay}</dd>
        </div>
      </dl>

      <div className="dash__toolbar">
        <button type="button" className="op__secondary" onClick={refresh} disabled={busy}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
        {/* Not a live region: a routine minute-by-minute update isn't worth announcing. */}
        {!state.stale && <p className="dash__updated">Updated {time(state.updatedAt)}</p>}
      </div>
      {state.stale && (
        <p className="op__notice" role="alert">
          Couldn’t refresh — showing {time(state.updatedAt)}.
        </p>
      )}

      <h2 className="op__h2">Guests, newest first</h2>
      {rows.length === 0 ? (
        <p className="op__body">
          No one has joined yet. Guests join at{' '}
          <span className="op__code op__code--inline">{joinUrl(window.location.origin, eventId)}</span> — the
          table-card QR points there.
        </p>
      ) : (
        <ul className="dash__list">
          {rows.map((g) => (
            <GuestRow key={g.guestId} guest={g} now={now} />
          ))}
        </ul>
      )}

      <p className="op__hint dash__hint">
        “Saved” is what has reached the server; “on the way” is an upload that has started but not finished. Shots
        still waiting on a phone with no signal appear once that phone reconnects.
      </p>
    </>
  )
}
