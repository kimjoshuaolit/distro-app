import { useEffect, useRef } from 'react'
import type { ViewItem } from '../roll/useRoll.ts'
import RetroPlayback from './RetroPlayback.tsx'
import './RollViewer.css'

type Props = {
  items: ViewItem[] // viewable items only (src !== null), in roll order
  index: number
  total: number // shots in the whole roll — frame numbers count against this
  onIndex: (index: number) => void
  onClose: () => void
  onMediaError: (id: string) => void
  /** Optional: the shown shot's media loaded (the couple view pins that URL). */
  onMediaLoad?: (id: string) => void
}

const SWIPE_PX = 50

/**
 * Full-frame view of one shot, with prev/next through the roll. Read-only.
 * The parent makes the page behind it inert and owns focus restoration.
 */
export default function RollViewer({ items, index, total, onIndex, onClose, onMediaError, onMediaLoad }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const swipeStart = useRef<number | null>(null)
  const swiped = useRef(false)
  const item = items[index]
  const hasPrev = index > 0
  const hasNext = index < items.length - 1

  // Keyboard: ←/→ to move, Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onIndex, onClose])

  // Move focus into the dialog when it opens.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  if (!item || !item.src) return null
  const kind = item.type === 'clip' ? 'clip' : 'photo'
  const label = `Frame ${item.frame} of ${total}, ${kind}`

  return (
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onPointerDown={(e) => {
        swipeStart.current = e.clientX
        swiped.current = false
      }}
      onPointerCancel={() => (swipeStart.current = null)}
      onPointerUp={(e) => {
        const start = swipeStart.current
        swipeStart.current = null
        if (start === null) return
        const dx = e.clientX - start
        if (Math.abs(dx) <= SWIPE_PX) return
        if (dx > 0 && hasPrev) onIndex(index - 1)
        else if (dx < 0 && hasNext) onIndex(index + 1)
        swiped.current = true
      }}
      // A swipe that ends on a button or the video must not also "click" it.
      onClickCapture={(e) => {
        if (!swiped.current) return
        swiped.current = false
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="viewer__bar">
        <span className="viewer__frame">
          {String(item.frame).padStart(2, '0')}
          <span className="viewer__of"> / {total}</span>
        </span>
        <button ref={closeRef} type="button" className="viewer__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="viewer__stage">
        {item.type === 'clip' ? (
          <RetroPlayback
            key={item.id}
            src={item.src}
            capturedAt={item.capturedAt}
            label={label}
            onError={() => onMediaError(item.id)}
            onLoaded={onMediaLoad ? () => onMediaLoad(item.id) : undefined}
          />
        ) : (
          <img
            key={item.id}
            className="viewer__photo"
            src={item.src}
            alt={label}
            draggable={false}
            onError={() => onMediaError(item.id)}
            onLoad={onMediaLoad ? () => onMediaLoad(item.id) : undefined}
          />
        )}
      </div>

      <div className="viewer__nav">
        <button
          type="button"
          className="viewer__step"
          onClick={() => onIndex(index - 1)}
          disabled={!hasPrev}
          aria-label="Previous shot"
        >
          ‹
        </button>
        <button
          type="button"
          className="viewer__step"
          onClick={() => onIndex(index + 1)}
          disabled={!hasNext}
          aria-label="Next shot"
        >
          ›
        </button>
      </div>
    </div>
  )
}
