import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { getEvent } from '../lib/operatorApi'
import { isLocalOrigin, joinUrl, QR_OPTIONS, qrFilename } from './qr'
import './TableCards.css'

type Loaded =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'failed' }
  | { state: 'ready'; names: string | null; svgUrl: string; pngUrl: string; url: string }

const CARDS_PER_SHEET = 4

/**
 * O1 — the printable table cards (Story 3.2): 4 Kodak Sunset cards per A4 /
 * Letter sheet, each with the couple's names and a QR to the guest join page,
 * plus a high-res PNG for Kim's own designs. The QR is drawn in the browser.
 */
export default function TableCards({ eventId }: { eventId: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const origin = window.location.origin
  const local = isLocalOrigin(origin)

  useEffect(() => {
    let live = true
    const url = joinUrl(origin, eventId)
    getEvent(eventId)
      .then(async (event) => {
        if (!event) return live && setLoaded({ state: 'missing' })
        const [svg, pngUrl] = await Promise.all([
          QRCode.toString(url, { ...QR_OPTIONS, type: 'svg', color: { dark: '#2b2a26', light: '#ffffff' } }),
          QRCode.toDataURL(url, { ...QR_OPTIONS, width: 1024, color: { dark: '#000000', light: '#ffffff' } }),
        ])
        const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        if (live) setLoaded({ state: 'ready', names: event.coupleNames, svgUrl, pngUrl, url })
      })
      .catch(() => live && setLoaded({ state: 'failed' }))
    return () => {
      live = false
    }
  }, [eventId, origin, attempt])

  const back = (
    <p className="op__back">
      <Link to={`/operator/events/${eventId}`}>← Back to the event</Link>
    </p>
  )

  if (loaded.state === 'loading') {
    return (
      <>
        {back}
        <p className="op__body">Making your table cards…</p>
      </>
    )
  }
  if (loaded.state === 'missing') {
    return (
      <>
        <p className="op__back">
          <Link to="/operator">← All events</Link>
        </p>
        <h1 className="op__title">Event not found</h1>
      </>
    )
  }
  if (loaded.state === 'failed') {
    return (
      <>
        {back}
        <p className="op__notice" role="alert">
          Couldn’t make the cards — check your connection.
        </p>
        <button
          type="button"
          className="op__secondary"
          onClick={() => {
            setLoaded({ state: 'loading' })
            setAttempt((a) => a + 1)
          }}
        >
          Try again
        </button>
      </>
    )
  }

  const names = loaded.names ?? 'Our wedding'

  return (
    <div className="cards-page">
      <div className="cards__screen-only">
        {back}
        <h1 className="op__title">Table cards</h1>
        {local && (
          <p className="op__notice" role="alert">
            This page is running on <strong>{origin}</strong>, so these QRs point at your own computer and guests
            can’t reach them. Print from the live site instead.
          </p>
        )}
        <p className="op__body">
          Every QR opens <span className="op__code op__code--inline">{loaded.url}</span>. Scan one with your phone
          before printing a stack.
        </p>
        <div className="op__actions op__actions--tight">
          <button type="button" className="op__primary" onClick={() => window.print()}>
            Print cards
          </button>
          <a className="op__secondary" href={loaded.pngUrl} download={qrFilename(loaded.names, eventId)}>
            Download QR (PNG)
          </a>
        </div>
        <p className="op__hint">4 cards per A4 or Letter sheet — cut along the edges.</p>
      </div>

      <div className="cards__sheet" aria-label="Printable table cards">
        {Array.from({ length: CARDS_PER_SHEET }, (_, i) => (
          <article className="card" key={i} aria-hidden={i > 0 || undefined}>
            <div className="card__band" aria-hidden="true" />
            <p className="card__names">{names}</p>
            <p className="card__lead">Scan for your disposable camera</p>
            <img className="card__qr" src={loaded.svgUrl} alt={`QR code that opens ${loaded.url}`} />
            <p className="card__rules">25 photos · 5 clips · no app, no retakes</p>
            <p className="card__foot">Make ’em count 📸</p>
          </article>
        ))}
      </div>
    </div>
  )
}
