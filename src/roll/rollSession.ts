import type { Shot } from '../capture/db'
import type { ViewUrls } from '../lib/api'
import { mergeRoll, type RollItem } from './buildRoll'

// Pure, injectable pieces behind useRoll — testable in node without React.

/** A roll item ready to render: `src` is an object URL, a signed URL, or null. */
export type ViewItem = RollItem & { src: string | null }

/**
 * One object URL per on-device shot, reused across refreshes. Captures are
 * final (a shot id's blob never changes), so re-creating URLs on every upload
 * tick would only make playing clips restart and tiles reload. URLs for shots
 * that disappear are revoked; `dispose` revokes everything.
 */
export function createMediaCache(urlApi: { create: (blob: Blob) => string; revoke: (url: string) => void }) {
  const byId = new Map<string, string>()
  return {
    resolve(items: RollItem[]): ViewItem[] {
      const live = new Set<string>()
      const out = items.map((item): ViewItem => {
        if (item.media.kind === 'device') {
          live.add(item.id)
          let url = byId.get(item.id)
          if (!url) {
            url = urlApi.create(item.media.blob)
            byId.set(item.id, url)
          }
          return { ...item, src: url }
        }
        return { ...item, src: item.media.kind === 'cloud' ? item.media.url : null }
      })
      for (const [id, url] of byId) {
        if (!live.has(id)) {
          urlApi.revoke(url)
          byId.delete(id)
        }
      }
      return out
    },
    dispose(): void {
      for (const url of byId.values()) urlApi.revoke(url)
      byId.clear()
    },
  }
}

/** Re-ask for a view URL once it's within this long of expiring. */
export const VIEW_REFRESH_MARGIN_MS = 60_000

/**
 * Signed view URLs with their expiry. `get` serves still-fresh URLs from cache
 * and fetches only missing/stale ones in a single call; it never throws (a
 * failed fetch just leaves those shots without a URL → "Unavailable").
 */
export function createViewUrlCache(fetchUrls: (ids: string[]) => Promise<ViewUrls>, now: () => number) {
  const byId = new Map<string, { url: string; expiresAt: number }>()
  const isFresh = (e: { expiresAt: number }) => e.expiresAt - now() > VIEW_REFRESH_MARGIN_MS

  return {
    async get(ids: string[]): Promise<Record<string, string>> {
      const out: Record<string, string> = {}
      const missing: string[] = []
      for (const id of ids) {
        const cached = byId.get(id)
        if (cached && isFresh(cached)) out[id] = cached.url
        else missing.push(id)
      }
      if (missing.length === 0) return out
      try {
        const { urls, expiresIn } = await fetchUrls(missing)
        const expiresAt = now() + expiresIn * 1000
        for (const [id, url] of Object.entries(urls)) {
          out[id] = url
          // Only cache links with a real lifetime; otherwise refresh timers could spin.
          if (expiresIn > 0) byId.set(id, { url, expiresAt })
        }
      } catch {
        // keep what we have; the rest render as unavailable until the next refresh
      }
      return out
    },
    /** Forget one URL (e.g. the media element failed to load it). */
    invalidate(id: string): void {
      byId.delete(id)
    },
    /**
     * Earliest expiry among cached URLs, for scheduling a refresh; null if none.
     * `ids` narrows it to the URLs still on screen, so links nobody is looking
     * at any more can't keep waking the refresh timer.
     */
    nextExpiry(ids?: string[]): number | null {
      let min: number | null = null
      const entries = ids ? ids.map((id) => byId.get(id)) : [...byId.values()]
      for (const e of entries) {
        if (e) min = min === null ? e.expiresAt : Math.min(min, e.expiresAt)
      }
      return min
    },
  }
}

export type ViewUrlCache = ReturnType<typeof createViewUrlCache>

/**
 * Load sequence: read the phone, paint device-only right away (AD-1: the roll
 * never waits on the network), then commit the full device + server roll.
 * `build` is absent when there's no guest token. Never throws.
 */
export async function loadRoll(
  deps: { readLocal: () => Promise<Shot[]>; build?: (local: Shot[]) => Promise<RollItem[]> },
  opts: { paintDeviceFirst: boolean },
  commit: (items: RollItem[]) => void,
): Promise<void> {
  const local = await deps.readLocal().catch(() => [] as Shot[])
  if (opts.paintDeviceFirst || !deps.build) commit(mergeRoll(local, null))
  if (!deps.build) return
  commit(await deps.build(local))
}

/**
 * The viewer only pages through shots that have something to show; map the
 * open shot id to its position among those (-1 when closed or gone).
 */
export function viewerState(items: ViewItem[], openId: string | null) {
  const viewable = items.filter((i) => i.src !== null)
  const index = openId === null ? -1 : viewable.findIndex((i) => i.id === openId)
  return { viewable, index }
}
