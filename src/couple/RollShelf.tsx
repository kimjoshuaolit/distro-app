import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { countLabel, type CollectionFrame, type CoupleRoll } from './buildCollection.ts'
import { useLoadedSrc } from './useLoadedSrc.ts'
import './RollShelf.css'

type Props = {
  eventId: string
  rolls: CoupleRoll[]
  urls: Record<string, string>
  unavailable: ReadonlySet<string>
  onMediaError: (shotId: string) => void
  onMediaLoad: (shotId: string) => void
}

/** The cover image (or first frame of a clip); blank when it has no link, failed, or is unavailable. */
function Cover({
  frame,
  latest,
  onMediaError,
  onMediaLoad,
}: {
  frame: CollectionFrame
  latest: string | null
  onMediaError: () => void
  onMediaLoad: () => void
}) {
  const media = useLoadedSrc(latest)
  if (!media.src) return <span className="print__cover print__cover--blank" aria-hidden="true" />
  const onLoad = () => {
    media.onLoad()
    onMediaLoad()
  }
  const onError = () => {
    media.onError()
    onMediaError()
  }
  return (
    <span className="print__cover" aria-hidden="true">
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
          <span className="print__play">▶</span>
        </>
      ) : (
        <img src={media.src} alt="" loading="lazy" decoding="async" draggable={false} onLoad={onLoad} onError={onError} />
      )}
    </span>
  )
}

/**
 * The shelf (2.2): one cream-bordered print per guest who has uploaded
 * anything, A–Z, each opening that guest's roll. Coming back from a roll
 * (router state `fromGuest`) puts focus on that roll's print, once.
 */
export default function RollShelf({ eventId, rolls, urls, unavailable, onMediaError, onMediaLoad }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const fromGuest = (location.state as { fromGuest?: unknown } | null)?.fromGuest

  useEffect(() => {
    if (typeof fromGuest !== 'string' || rolls.length === 0) return
    document.querySelector<HTMLElement>(`[data-guest-id="${CSS.escape(fromGuest)}"]`)?.focus()
    // Used up: a reload or Back/Forward to this entry must not steal focus again.
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }, [fromGuest, rolls, navigate, location.pathname, location.search])

  return (
    <ul className="shelf" aria-label="Your guests’ rolls">
      {rolls.map((roll) => {
        const counts = countLabel(roll.photos, roll.clips)
        const coverId = roll.cover.id
        return (
          <li key={roll.guestId}>
            <Link
              className="print"
              to={`/reveal/${eventId}/roll/${roll.guestId}`}
              data-guest-id={roll.guestId}
              aria-label={`${roll.label}, ${counts}`}
            >
              <Cover
                frame={roll.cover}
                latest={unavailable.has(coverId) ? null : (urls[coverId] ?? null)}
                onMediaError={() => onMediaError(coverId)}
                onMediaLoad={() => onMediaLoad(coverId)}
              />
              <span className="print__label">{roll.label}</span>
              <span className="print__count">{counts}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
