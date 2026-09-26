import { useState } from 'react'

/**
 * The URL one media element should show, given the latest signed URL for its
 * shot. Once the element has loaded a URL it keeps it: a proactive refresh
 * must not swap `src` under an image that's already on screen (it would
 * re-download) or a clip that's playing (it would restart). A fresh URL only
 * reaches an element that hasn't loaded yet, or one that reported an error;
 * after an error the same URL is never retried — the element waits (blank) for
 * a re-signed one.
 */
export function useLoadedSrc(latest: string | null) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const src = loaded ?? (latest !== null && latest !== failed ? latest : null)
  return {
    src,
    /** The last link this element had failed, and no new one has arrived yet. */
    failed: src === null && latest !== null && latest === failed,
    onLoad: () => {
      if (src !== null) setLoaded(src)
    },
    onError: () => {
      setLoaded(null)
      setFailed(src)
    },
  }
}
