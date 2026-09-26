import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getEvent, saveEvent, SaveEventError, type EventDetail } from '../lib/operatorApi'
import {
  MAX_COUPLE_NAMES,
  validateSaveEventRequest,
  type SaveEventField,
} from '../../supabase/functions/_shared/operator-rules.ts'
import { isoToLocalInput, localInputToIso, localZoneName } from './localTime'
import WindowControl from './WindowControl'

type Values = { coupleNames: string; opens: string; closes: string; email1: string; email2: string }

const EMPTY: Values = { coupleNames: '', opens: '', closes: '', email1: '', email2: '' }

/** The stored window, so an untouched time is saved back exactly (seconds included). */
type Stored = { opens: string; closes: string; openIso: string | null; closeIso: string | null }

const NO_STORED: Stored = { opens: '', closes: '', openIso: null, closeIso: null }

function valuesFrom(event: EventDetail): Values {
  return {
    coupleNames: event.coupleNames ?? '',
    opens: isoToLocalInput(event.windowOpen),
    closes: isoToLocalInput(event.windowClose),
    email1: event.coupleEmails[0] ?? '',
    email2: event.coupleEmails[1] ?? '',
  }
}

/** Which input to focus (and describe) for each field the rules can blame. */
const FIELD_INPUT: Partial<Record<SaveEventField, string>> = {
  coupleNames: 'coupleNames',
  window: 'windowOpens',
  coupleEmails: 'email1',
}

const FIELD_OF: Record<keyof Values, SaveEventField> = {
  coupleNames: 'coupleNames',
  opens: 'window',
  closes: 'window',
  email1: 'coupleEmails',
  email2: 'coupleEmails',
}

const SERVER_COPY: Record<string, string> = {
  not_operator: 'This console is for the operator — sign out and use the operator email.',
  not_found: 'That event doesn’t exist any more.',
  server_error: 'That didn’t save — check your connection and try again.',
}

const KNOWN_FIELDS: SaveEventField[] = ['body', 'eventId', 'coupleNames', 'window', 'coupleEmails']

/** Copyable links for the edit page: the guests' join link and the couple's reveal. */
function EventLinks({ eventId }: { eventId: string }) {
  const origin = window.location.origin
  return (
    <section className="op__links" aria-labelledby="linksHeading">
      <h2 id="linksHeading" className="op__h2">
        Links
      </h2>
      <p className="op__label">Guests join (the QR will point here)</p>
      <p className="op__code">{`${origin}/j/${eventId}`}</p>
      <p className="op__label">The couple’s reveal</p>
      <p className="op__code">{`${origin}/reveal/${eventId}`}</p>
      <div className="op__actions op__actions--tight">
        <Link className="op__primary" to={`/operator/events/${eventId}/cards`}>
          Table cards &amp; QR
        </Link>
        <Link className="op__secondary" to={`/operator/events/${eventId}/dashboard`}>
          Dashboard
        </Link>
      </div>
    </section>
  )
}

/**
 * Create (eventId null) or edit one event: couple names, the camera window in
 * local time, and up to two couple emails. Validated with the same rules as
 * save-event; the server still has the final say.
 */
export default function EventForm({ eventId, announce }: { eventId: string | null; announce: (t: string) => void }) {
  const navigate = useNavigate()
  const [load, setLoad] = useState<{ id: string | null; state: 'loading' | 'ready' | 'missing' | 'failed' }>({
    id: eventId,
    state: eventId ? 'loading' : 'ready',
  })
  const [values, setValues] = useState<Values>(EMPTY)
  const [stored, setStored] = useState<Stored>(NO_STORED)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [fieldError, setFieldError] = useState<{ field: SaveEventField; message: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // The id this form just created: navigating to it keeps the form as-is.
  const [createdId, setCreatedId] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // A different event (or new) resets the form — except the one just created.
  if (load.id !== eventId) {
    if (eventId !== null && eventId === createdId) {
      setLoad({ id: eventId, state: 'ready' })
    } else {
      setLoad({ id: eventId, state: eventId ? 'loading' : 'ready' })
      setValues(EMPTY)
      setStored(NO_STORED)
      setFieldError(null)
      setFormError(null)
      setSaved(false)
    }
  }

  useEffect(() => {
    if (!eventId || eventId === createdId) return
    let live = true
    getEvent(eventId).then(
      (event) => {
        if (!live) return
        if (!event) return setLoad({ id: eventId, state: 'missing' })
        const v = valuesFrom(event)
        setValues(v)
        setStored({ opens: v.opens, closes: v.closes, openIso: event.windowOpen, closeIso: event.windowClose })
        setLoad({ id: eventId, state: 'ready' })
      },
      () => live && setLoad({ id: eventId, state: 'failed' }),
    )
    return () => {
      live = false
    }
  }, [eventId, attempt, createdId])

  function set<K extends keyof Values>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }))
    setSaved(false)
    if (fieldError?.field === FIELD_OF[key]) setFieldError(null)
  }

  function blame(field: SaveEventField, message: string) {
    setFieldError({ field, message })
    const id = FIELD_INPUT[field]
    if (id) requestAnimationFrame(() => document.getElementById(id)?.focus())
  }

  /** An untouched time goes back exactly as stored; an edited one is converted. */
  function windowIso(input: string, storedInput: string, storedIso: string | null): string {
    if (storedIso && input === storedInput) return storedIso
    return localInputToIso(input) ?? ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setFieldError(null)
    setFormError(null)
    const parsed = validateSaveEventRequest({
      eventId,
      coupleNames: values.coupleNames,
      windowOpen: windowIso(values.opens, stored.opens, stored.openIso),
      windowClose: windowIso(values.closes, stored.closes, stored.closeIso),
      coupleEmails: [values.email1, values.email2].map((s) => s.trim()).filter(Boolean),
    })
    if (!parsed.ok) {
      blame(parsed.field, parsed.message)
      return
    }
    setSaving(true)
    announce('Saving…')
    try {
      const id = await saveEvent(parsed.value)
      if (!mounted.current) return // the operator left mid-save: don't pull them back
      setSaved(true)
      setStored({
        opens: values.opens,
        closes: values.closes,
        openIso: parsed.value.windowOpen,
        closeIso: parsed.value.windowClose,
      })
      announce(eventId ? 'Saved.' : 'Event created.')
      if (!eventId) {
        setCreatedId(id)
        navigate(`/operator/events/${id}`, { replace: true })
      }
    } catch (err) {
      if (!mounted.current) return
      announce('')
      const field = err instanceof SaveEventError ? (err.field as SaveEventField | null) : null
      if (err instanceof SaveEventError && err.code === 'bad_request') {
        if (field && KNOWN_FIELDS.includes(field)) blame(field, err.message)
        else setFormError(err.message)
      } else {
        const code = err instanceof SaveEventError ? err.code : 'server_error'
        setFormError(SERVER_COPY[code] ?? SERVER_COPY.server_error)
      }
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  const title = eventId ? 'Edit event' : 'New event'
  const back = (
    <p className="op__back">
      <Link to="/operator">← All events</Link>
    </p>
  )

  if (load.state === 'loading') {
    return (
      <>
        {back}
        <h1 className="op__title">{title}</h1>
        <p className="op__body">Loading the event…</p>
      </>
    )
  }
  if (load.state === 'missing') {
    return (
      <>
        {back}
        <h1 className="op__title">Event not found</h1>
        <p className="op__body">That event doesn’t exist, or the link is wrong.</p>
      </>
    )
  }
  if (load.state === 'failed') {
    return (
      <>
        {back}
        <h1 className="op__title">{title}</h1>
        <p className="op__notice" role="alert">
          Couldn’t load the event — check your connection.
        </p>
        <button type="button" className="op__secondary" onClick={() => setAttempt((a) => a + 1)}>
          Try again
        </button>
      </>
    )
  }

  const errorId = (field: SaveEventField) => `${field}Error`
  const err = (field: SaveEventField) =>
    fieldError?.field === field ? (
      <p id={errorId(field)} className="op__field-error" role="alert">
        {fieldError.message}
      </p>
    ) : null
  const invalid = (field: SaveEventField) => (fieldError?.field === field ? 'true' : undefined)
  const describedBy = (field: SaveEventField, hint?: string) =>
    [hint, fieldError?.field === field ? errorId(field) : null].filter(Boolean).join(' ') || undefined

  return (
    <>
      {back}
      <h1 className="op__title">{title}</h1>
      {eventId && (
        <WindowControl
          eventId={eventId}
          windowOpen={stored.openIso}
          windowClose={stored.closeIso}
          disabled={saving}
          onChanged={({ windowOpen, windowClose }) => {
            // The server moved the window: show it in the form too, so a later
            // save doesn't put the old times back.
            const opens = isoToLocalInput(windowOpen)
            const closes = isoToLocalInput(windowClose)
            setValues((v) => ({ ...v, opens, closes }))
            setStored({ opens, closes, openIso: windowOpen, closeIso: windowClose })
            announce('Camera window updated.')
          }}
        />
      )}
      <form className="op__form" onSubmit={handleSubmit} noValidate aria-busy={saving || undefined}>
        <label className="op__label" htmlFor="coupleNames">
          Couple names
        </label>
        <input
          id="coupleNames"
          className="op__input"
          value={values.coupleNames}
          maxLength={MAX_COUPLE_NAMES}
          placeholder="Ana & Ben"
          readOnly={saving}
          onChange={(e) => set('coupleNames', e.target.value)}
          aria-invalid={invalid('coupleNames')}
          aria-describedby={describedBy('coupleNames')}
        />
        {err('coupleNames')}

        <fieldset className="op__fieldset">
          <legend className="op__label">When the camera is open</legend>
          <p id="windowHint" className="op__hint">
            In your time zone ({localZoneName()}) — from the ceremony to the end of the afterparty.
          </p>
          <div className="op__row">
            <label className="op__sublabel">
              Opens
              <input
                id="windowOpens"
                type="datetime-local"
                className="op__input"
                value={values.opens}
                readOnly={saving}
                onChange={(e) => set('opens', e.target.value)}
                aria-invalid={invalid('window')}
                aria-describedby={describedBy('window', 'windowHint')}
              />
            </label>
            <label className="op__sublabel">
              Closes
              <input
                type="datetime-local"
                className="op__input"
                value={values.closes}
                readOnly={saving}
                onChange={(e) => set('closes', e.target.value)}
                aria-invalid={invalid('window')}
                aria-describedby={describedBy('window', 'windowHint')}
              />
            </label>
          </div>
          {err('window')}
        </fieldset>

        <fieldset className="op__fieldset">
          <legend className="op__label">Couple emails</legend>
          <p id="emailsHint" className="op__hint">
            Up to two. Only these inboxes can sign in to the reveal. Removing one takes away that inbox’s access.
          </p>
          <label className="op__sublabel">
            Partner one
            <input
              id="email1"
              type="email"
              className="op__input"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={values.email1}
              readOnly={saving}
              onChange={(e) => set('email1', e.target.value)}
              aria-invalid={invalid('coupleEmails')}
              aria-describedby={describedBy('coupleEmails', 'emailsHint')}
            />
          </label>
          <label className="op__sublabel">
            Partner two
            <input
              type="email"
              className="op__input"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={values.email2}
              readOnly={saving}
              onChange={(e) => set('email2', e.target.value)}
              aria-invalid={invalid('coupleEmails')}
              aria-describedby={describedBy('coupleEmails', 'emailsHint')}
            />
          </label>
          {err('coupleEmails')}
        </fieldset>

        {(fieldError?.field === 'body' || fieldError?.field === 'eventId') && (
          <p className="op__notice" role="alert">
            {fieldError.message}
          </p>
        )}
        {formError && (
          <p className="op__notice" role="alert">
            {formError}
          </p>
        )}

        <div className="op__actions">
          <button type="submit" className="op__primary" disabled={saving}>
            {saving ? 'Saving…' : eventId ? 'Save changes' : 'Create event'}
          </button>
          {saved && !saving && <span className="op__saved">Saved ✓</span>}
        </div>
      </form>

      {eventId && <EventLinks eventId={eventId} />}
    </>
  )
}
