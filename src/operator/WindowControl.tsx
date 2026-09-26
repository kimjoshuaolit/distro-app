import { useEffect, useState } from 'react'
import { setWindow, WindowError, type WindowTimes } from '../lib/operatorApi'
import { uploadsUntil, UPLOAD_GRACE_DAYS, windowPhase } from '../../supabase/functions/_shared/window-rules.ts'

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const ERROR_COPY: Record<string, string> = {
  not_operator: 'This console is for the operator — sign out and use the operator email.',
  not_found: 'That event doesn’t exist any more.',
}

/**
 * The night-of switch (Story 3.2): where the camera window stands, with Open
 * now / Close now. Closing asks first — it's for every guest at once. The
 * server moves the window to its own clock; the answer updates the page.
 */
export default function WindowControl({
  eventId,
  windowOpen,
  windowClose,
  disabled = false,
  onChanged,
}: {
  eventId: string
  windowOpen: string | null
  windowClose: string | null
  /** e.g. while the event form is saving, so the two can't race. */
  disabled?: boolean
  onChanged: (times: WindowTimes) => void
}) {
  const [clientNow, setClientNow] = useState(() => Date.now())
  // Server clock minus this laptop's clock, learned from the last Open/Close
  // answer (it stamps the server's now()), so a laptop running slow or fast
  // doesn't show "Open" right after closing.
  const [skewMs, setSkewMs] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Keep the phase honest while the page sits open (e.g. a scheduled close passes).
  useEffect(() => {
    const t = window.setInterval(() => setClientNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const now = new Date(clientNow + skewMs)
  const phase = windowPhase(windowOpen, windowClose, now)
  const until = uploadsUntil(windowClose)
  const uploadsOver = until !== null && now.getTime() > Date.parse(until)

  // A pending "Close the camera?" never outlives the open phase it was asked in.
  if (confirming && phase !== 'open') setConfirming(false)

  async function run(action: 'open' | 'close') {
    if (busy || disabled) return
    setBusy(true)
    setError(null)
    try {
      const sentAt = Date.now()
      const times = await setWindow(eventId, action)
      const receivedAt = Date.now()
      // The moved end is the server's now() for this request.
      const serverNow = Date.parse(action === 'close' ? times.windowClose : times.windowOpen)
      const stamped = serverNow === Date.parse(action === 'close' ? windowClose ?? '' : windowOpen ?? '')
      if (!stamped && !Number.isNaN(serverNow)) setSkewMs(serverNow - (sentAt + receivedAt) / 2)
      setConfirming(false)
      setClientNow(receivedAt)
      onChanged(times)
    } catch (err) {
      const code = err instanceof WindowError ? err.code : 'server_error'
      setError(ERROR_COPY[code] ?? 'That didn’t go through — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  let line: string
  if (phase === 'unset') line = 'No window set — the camera isn’t open.'
  else if (phase === 'scheduled') line = `Not open yet · opens ${fmt(windowOpen!)}`
  else if (phase === 'open') line = windowClose ? `Open now · closes ${fmt(windowClose)}` : 'Open now · no close time'
  else if (uploadsOver) line = `Closed ${fmt(windowClose!)} · uploads have closed too`
  else line = `Closed ${fmt(windowClose!)}${until ? ` · late uploads accepted until ${fmt(until)}` : ''}`

  const off = busy || disabled

  return (
    <section className="op__window" aria-labelledby="windowHeading">
      <h2 id="windowHeading" className="op__h2">
        Camera
      </h2>
      <p className={`op__phase op__phase--${phase}`} role="status">
        {line}
      </p>

      {phase === 'open' && !confirming && (
        <div className="op__actions op__actions--tight">
          <button type="button" className="op__danger" onClick={() => setConfirming(true)} disabled={off}>
            Close now
          </button>
        </div>
      )}

      {phase === 'open' && confirming && (
        <div className="op__confirm" role="group" aria-labelledby="confirmCloseText">
          <p id="confirmCloseText" className="op__body">
            <strong>Close the camera for everyone?</strong> Guests can’t join or take new shots after this. Shots
            already taken keep uploading for {UPLOAD_GRACE_DAYS} days.
          </p>
          <div className="op__actions op__actions--tight">
            <button type="button" className="op__danger" onClick={() => run('close')} disabled={off}>
              {busy ? 'Closing…' : 'Yes, close it'}
            </button>
            <button type="button" className="op__secondary" onClick={() => setConfirming(false)} disabled={busy}>
              Keep it open
            </button>
          </div>
        </div>
      )}

      {phase !== 'open' && (
        <div className="op__actions op__actions--tight">
          <button type="button" className="op__primary" onClick={() => run('open')} disabled={off}>
            {busy ? 'Opening…' : 'Open now'}
          </button>
        </div>
      )}
      {phase === 'closed' && (
        <p className="op__hint">Opening again starts now and runs for 12 hours (edit the close time below).</p>
      )}

      {error && (
        <p className="op__notice" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
