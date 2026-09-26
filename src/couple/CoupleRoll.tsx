import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import RollViewer from '../ui/RollViewer.tsx'
import { viewerState, type ViewItem } from '../roll/rollSession.ts'
import { countLabel, type CollectionFrame, type CoupleRoll as Roll } from './buildCollection.ts'
import type { CollectionStatus } from './useCollection.ts'
import { useLoadedSrc } from './useLoadedSrc.ts'
import './CoupleRoll.css'

type Props = {
  eventId: string
  guestId: string
  status: CollectionStatus
  roll: Roll | undefined // undefined when ready: not a roll on this event's shelf
  urls: Record<string, string>
  unavailable: ReadonlySet<string>
  onMediaError: (shotId: string) => void
  onMediaLoad: (shotId: string) => void
  onRetry: () => void
  header: ReactNode // the reveal kicker
  footer: ReactNode // page actions (sign out)
}

const frameNo = (n: number) => String(n).padStart(2, '0')

function Tile({
  frame,
  latest,
  unavailable,
  total,
  onOpen,
  onMediaError,
  onMediaLoad,
}: {
  frame: CollectionFrame
  latest: string | null
  unavailable: boolean
  total: number
  onOpen: () => void
  onMediaError: () => void
  onMediaLoad: () => void
}) {
  const media = useLoadedSrc(latest)
  const kind = frame.type === 'clip' ? 'clip' : 'photo'
  const label = `Frame ${frame.frame} of ${total}, ${kind}`
  const number = <span className="tile__no">{frameNo(frame.frame)}</span>

  if (!media.src) {
    const state = unavailable ? 'unavailable' : media.failed ? 'couldn’t load, trying again' : 'not ready yet'
    return (
      <div className="tile tile--blank" role="img" aria-label={`${label}, ${state}`}>
        <span className="tile__media" aria-hidden="true" />
        {number}
      </div>
    )
  }

  const onLoad = () => {
    media.onLoad()
    onMediaLoad()
  }
  const onError = () => {
    media.onError()
    onMediaError()
  }
  return (
    <button type="button" className="tile" onClick={onOpen} aria-label={label} data-shot-id={frame.id}>
      <span className="tile__media" aria-hidden="true">
        {frame.type === 'clip' ? (
          <>
            {/* #t nudges browsers to paint the first frame as a poster. */}
            <video
              className="retro-grade"
              src={`${media.src}#t=0.1`}
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={onLoad}
              onError={onError}
            />
            <span className="tile__play">▶</span>
          </>
        ) : (
          <img src={media.src} alt="" loading="lazy" decoding="async" draggable={false} onLoad={onLoad} onError={onError} />
        )}
      </span>
      {number}
    </button>
  )
}

/**
 * One guest's roll (2.2): a contact sheet in capture order, numbered, opening
 * the full-frame viewer (swipe / ←→ / Esc; clips get the retro look at
 * playback). Read-only. Media is whatever the couple-tier signer vouched for.
 * A deep link shows a roll-level loading or error state until the collection
 * is in.
 */
export default function CoupleRoll({
  eventId,
  guestId,
  status,
  roll,
  urls,
  unavailable,
  onMediaError,
  onMediaLoad,
  onRetry,
  header,
  footer,
}: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  // The URL the viewer's current element loaded with: kept while it's on
  // screen so a background refresh can't restart a playing clip.
  const [viewerPin, setViewerPin] = useState<{ id: string; src: string } | null>(null)
  const restoreFocusTo = useRef<string | null>(null)
  const shelf = `/reveal/${eventId}`

  const items: ViewItem[] = (roll?.frames ?? []).map((f) => {
    const src = unavailable.has(f.id) ? null : (urls[f.id] ?? null)
    return {
      ...f,
      status: 'saved',
      media: src ? { kind: 'cloud', url: src } : { kind: 'none' },
      src,
    }
  })
  const { viewable, index: openIndex } = viewerState(items, openId)
  const viewerItems = viewable.map((i) => (viewerPin && i.id === viewerPin.id ? { ...i, src: viewerPin.src } : i))
  const viewerOpen = openIndex >= 0

  // A new page starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [guestId])

  // Put focus on the page's heading when it (re)appears — loading, error or
  // the roll itself — unless the couple has already moved focus somewhere.
  const found = roll !== undefined
  useEffect(() => {
    const active = document.activeElement
    if (!active || active === document.body) titleRef.current?.focus()
  }, [guestId, status, found])

  // Keep the page behind the full-frame viewer still (esp. iOS rubber-banding).
  useEffect(() => {
    if (!viewerOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [viewerOpen])

  // Return focus to the frame last viewed — tapping doesn't focus buttons in
  // Safari, so "restore whatever had focus" isn't enough. Done after the commit
  // that lifts `inert` (an inert button can't take focus), not on a frame timer.
  // Also covers the viewer closing because its shot became unavailable.
  useEffect(() => {
    if (viewerOpen) return
    const lastId = restoreFocusTo.current ?? openId
    if (!lastId) return
    restoreFocusTo.current = null
    // An unavailable frame is no longer a button: fall back to the heading.
    const target = document.querySelector<HTMLElement>(`[data-shot-id="${CSS.escape(lastId)}"]`) ?? titleRef.current
    target?.focus()
  }, [viewerOpen, openId])

  const openViewer = (id: string) => {
    setViewerPin(null)
    setOpenId(id)
  }
  const closeViewer = () => {
    restoreFocusTo.current = openId
    setViewerPin(null)
    setOpenId(null)
  }
  const showIndex = (i: number) => {
    const next = viewerItems[i]
    if (next) openViewer(next.id)
    else closeViewer()
  }

  const back = (
    <div className="couple-roll__nav">
      <Link className="couple-roll__back" to={shelf} state={{ fromGuest: guestId }}>
        <span aria-hidden="true">←</span>All rolls
      </Link>
    </div>
  )
  const title = (text: string) => (
    <h1 ref={titleRef} tabIndex={-1} className="reveal__title">
      {text}
    </h1>
  )

  if (status === 'loading') {
    return (
      <div className="couple-roll">
        {header}
        {back}
        {title('Developing this roll…')}
        <p className="reveal__body">Bringing it in from the lab — just a moment.</p>
        {footer}
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="couple-roll">
        {header}
        {back}
        {title('We couldn’t bring this roll in')}
        <p className="reveal__notice" role="alert">
          Check your connection and try again.
        </p>
        <div className="reveal__actions">
          <button type="button" className="reveal__primary reveal__primary--inline" onClick={onRetry}>
            Try again
          </button>
        </div>
        {footer}
      </div>
    )
  }

  if (!roll) {
    return (
      <div className="couple-roll">
        {header}
        {back}
        {title('That roll isn’t here')}
        <p className="reveal__body">
          The link may be from another reveal, or mistyped. Every roll your guests shot is on your
          shelf.
        </p>
        {footer}
      </div>
    )
  }

  return (
    <>
      {/* inert while the viewer is up: Tab and screen readers stay in the dialog. */}
      <div className="couple-roll" inert={viewerOpen}>
        {header}
        {back}
        {title(roll.label)}
        <p className="couple-roll__meta">{countLabel(roll.photos, roll.clips)}</p>

        <ol className="couple-roll__sheet" aria-label={`${roll.label}, in the order it was shot`}>
          {items.map((item) => (
            <li key={item.id}>
              <Tile
                frame={item}
                latest={item.src}
                unavailable={unavailable.has(item.id)}
                total={items.length}
                onOpen={() => openViewer(item.id)}
                onMediaError={() => onMediaError(item.id)}
                onMediaLoad={() => onMediaLoad(item.id)}
              />
            </li>
          ))}
        </ol>

        {footer}
      </div>

      {viewerOpen && (
        <RollViewer
          items={viewerItems}
          index={openIndex}
          total={items.length}
          onIndex={showIndex}
          onClose={closeViewer}
          onMediaError={(id) => {
            setViewerPin((pin) => (pin?.id === id ? null : pin))
            onMediaError(id)
          }}
          onMediaLoad={(id) => {
            const shown = viewerItems.find((i) => i.id === id)?.src
            if (shown) setViewerPin({ id, src: shown })
            onMediaLoad(id)
          }}
        />
      )}
    </>
  )
}
