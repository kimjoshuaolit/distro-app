import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { getGuestSession } from '../lib/guestSession.ts'
import { useUploader } from '../capture/useUploader.ts'
import { useRoll, type ViewItem } from '../roll/useRoll.ts'
import { viewerState } from '../roll/rollSession.ts'
import type { RollStatus } from '../roll/buildRoll.ts'
import UploadIndicator from '../ui/UploadIndicator.tsx'
import RollViewer from '../ui/RollViewer.tsx'
import './Roll.css'

const BADGE: Record<RollStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  not_saved: 'Not saved — over the limit',
  unavailable: 'Unavailable',
}

const frameNo = (n: number) => String(n).padStart(2, '0')

function Tile({ item, onOpen, onMediaError }: { item: ViewItem; onOpen: () => void; onMediaError: () => void }) {
  const kind = item.type === 'clip' ? 'clip' : 'photo'
  const label = `Frame ${item.frame}, ${kind}, ${BADGE[item.status]}`
  const header = (
    <span className="frame__head">
      <span className="frame__no">{frameNo(item.frame)}</span>
      <span className={`frame__badge frame__badge--${item.status}`}>{BADGE[item.status]}</span>
    </span>
  )

  // Nothing to show (never uploaded and gone from the phone, or no view link).
  if (!item.src) {
    return (
      <div className="frame frame--empty" role="img" aria-label={label}>
        {header}
        <span className="frame__media frame__media--empty" aria-hidden="true">
          —
        </span>
      </div>
    )
  }

  return (
    <button type="button" className="frame" onClick={onOpen} aria-label={label} data-shot-id={item.id}>
      {header}
      <span className="frame__media">
        {item.type === 'clip' ? (
          <>
            {/* #t nudges browsers to paint the first frame as a poster. */}
            <video
              className="retro-grade"
              src={`${item.src}#t=0.1`}
              muted
              playsInline
              preload="metadata"
              onError={onMediaError}
            />
            <span className="frame__play" aria-hidden="true">
              ▶
            </span>
          </>
        ) : (
          <img src={item.src} alt="" loading="lazy" draggable={false} onError={onMediaError} />
        )}
      </span>
    </button>
  )
}

/** The guest's own roll as a contact sheet (FR11). Read-only: captures are final. */
export default function Roll() {
  const { eventToken = '' } = useParams()
  const navigate = useNavigate()
  const session = getGuestSession(eventToken)
  const deviceToken = session?.deviceToken ?? null
  const uploader = useUploader(eventToken, deviceToken)
  const roll = useRoll(eventToken, deviceToken, uploader.pendingCount)
  const [openId, setOpenId] = useState<string | null>(null)
  const { viewable, index: openIndex } = viewerState(roll.items, openId)
  const viewerOpen = openIndex >= 0

  // Keep the page behind the full-frame viewer still (esp. iOS rubber-banding).
  useEffect(() => {
    if (!viewerOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [viewerOpen])

  if (!session) return <Navigate to={`/j/${eventToken}`} replace />

  const toCamera = () => navigate(`/c/${eventToken}`)
  const closeViewer = () => {
    // Return focus to the frame the guest was last looking at — tapping doesn't
    // focus buttons in Safari, so "restore whatever had focus" isn't enough.
    const lastId = openId
    setOpenId(null)
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-shot-id="${lastId}"]`)?.focus()
    })
  }

  return (
    <main className="roll">
      {/* inert while the viewer is up: Tab and screen readers stay in the dialog. */}
      <div className="roll__page" inert={viewerOpen}>
        <header className="roll__head">
          <div>
            <h1 className="roll__title">My Roll</h1>
            <p className="roll__meta">
              {session.firstName}
              {roll.status === 'ready' && roll.items.length > 0 && (
                <>
                  {' '}
                  · {roll.items.length} {roll.items.length === 1 ? 'shot' : 'shots'}
                </>
              )}
            </p>
          </div>
          <button type="button" className="roll__back" onClick={toCamera}>
            ← Camera
          </button>
        </header>

        {roll.status === 'loading' && <p className="roll__note">Developing your roll…</p>}

        {roll.status === 'ready' && roll.items.length === 0 && (
          <section className="roll__empty">
            <p className="roll__empty-title">Your roll is empty 🎞️</p>
            <p className="roll__empty-body">
              Every shot you take lands here — no retakes, just moments. Go catch your first one.
            </p>
            <button type="button" className="roll__cta" onClick={toCamera}>
              Back to camera
            </button>
          </section>
        )}

        {roll.items.length > 0 && (
          <>
            <div className="roll__upload">
              <UploadIndicator
                state={uploader.state}
                pending={uploader.pendingCount}
                rejected={uploader.rejectedCount}
              />
            </div>
            <ol className="roll__sheet">
              {roll.items.map((item) => (
                <li key={item.id}>
                  <Tile
                    item={item}
                    onOpen={() => setOpenId(item.id)}
                    onMediaError={() => roll.reportBroken(item.id)}
                  />
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      {viewerOpen && (
        <RollViewer
          items={viewable}
          index={openIndex}
          total={roll.items.length}
          onIndex={(i) => setOpenId(viewable[i]?.id ?? null)}
          onClose={closeViewer}
          onMediaError={roll.reportBroken}
        />
      )}
    </main>
  )
}
