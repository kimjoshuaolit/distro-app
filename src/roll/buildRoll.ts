import type { Shot } from '../capture/db'
import type { ServerShot } from '../lib/api'

export type RollStatus = 'saved' | 'saving' | 'not_saved' | 'unavailable'

export type RollMedia =
  | { kind: 'device'; blob: Blob } // still on the phone
  | { kind: 'cloud'; url: string } // signed view URL (AD-2)
  | { kind: 'none' } // nothing to show

export type RollItem = {
  id: string // client shot id (= IndexedDB id)
  frame: number // 1-based, capture order — like the numbers on a contact sheet
  type: 'photo' | 'clip'
  capturedAt: string | null
  status: RollStatus
  media: RollMedia
}

type Unnumbered = Omit<RollItem, 'frame'>

// Local ISO strings end in "Z", Postgres returns "+00:00": compare as time,
// never as strings. Unknown times go last; ties break on id for stability.
function captureTime(iso: string | null): number {
  const t = iso ? Date.parse(iso) : Number.NaN
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t // unknown/garbled → last
}

function byCaptureTime(a: Unnumbered, b: Unnumbered): number {
  const ta = captureTime(a.capturedAt)
  const tb = captureTime(b.capturedAt)
  if (ta !== tb) return ta - tb
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Merge the on-device shots with the server's view of this guest's roll.
 * `server = null` means the server couldn't be reached: device-only roll.
 */
export function mergeRoll(local: Shot[], server: ServerShot[] | null): RollItem[] {
  const serverById = new Map((server ?? []).map((s) => [s.clientShotId, s]))
  const items: Unnumbered[] = []
  const onDevice = new Set<string>()

  for (const shot of local) {
    onDevice.add(shot.id)
    const remote = serverById.get(shot.id)
    let status: RollStatus
    if (shot.uploadStatus === 'rejected') status = 'not_saved'
    else if (shot.uploadStatus === 'uploaded' || remote?.uploadStatus === 'uploaded') status = 'saved'
    else status = 'saving'
    items.push({
      id: shot.id,
      type: shot.type,
      capturedAt: shot.capturedAt,
      status,
      media: { kind: 'device', blob: shot.blob },
    })
  }

  for (const remote of server ?? []) {
    if (onDevice.has(remote.clientShotId)) continue
    // Not on this phone any more. If it reached storage we can fetch a view
    // URL; if it was reserved but never uploaded, there is nothing to show.
    items.push({
      id: remote.clientShotId,
      type: remote.type,
      capturedAt: remote.capturedAt,
      status: remote.uploadStatus === 'uploaded' ? 'saved' : 'unavailable',
      media: { kind: 'none' },
    })
  }

  return items.sort(byCaptureTime).map((item, i) => ({ ...item, frame: i + 1 }))
}

/** Cloud-only shots that are safely stored and just need a view URL. */
export function idsNeedingViewUrls(items: RollItem[]): string[] {
  return items.filter((i) => i.media.kind === 'none' && i.status === 'saved').map((i) => i.id)
}

/** Attach signed URLs; a cloud-only shot the server didn't vouch for is unavailable. */
export function attachViewUrls(items: RollItem[], urls: Record<string, string>): RollItem[] {
  return items.map((item) => {
    if (item.media.kind !== 'none' || item.status !== 'saved') return item
    const url = urls[item.id]
    return url ? { ...item, media: { kind: 'cloud', url } } : { ...item, status: 'unavailable' }
  })
}

export type RollDeps = {
  getServerRoll: () => Promise<ServerShot[]>
  issueViewUrls: (ids: string[]) => Promise<Record<string, string>>
}

const MAX_VIEW_IDS = 30 // the server's per-request cap (a whole roll)

/**
 * Full roll: device shots + server state + view URLs for cloud-only shots.
 * Never throws — any network failure degrades gracefully (AD-1): no server →
 * device-only roll; no view URLs → those tiles become 'unavailable'.
 */
export async function buildRoll(local: Shot[], deps: RollDeps): Promise<RollItem[]> {
  let server: ServerShot[]
  try {
    server = await deps.getServerRoll()
  } catch {
    return mergeRoll(local, null)
  }

  const merged = mergeRoll(local, server)
  const needed = idsNeedingViewUrls(merged).slice(0, MAX_VIEW_IDS)
  if (needed.length === 0) return merged

  let urls: Record<string, string>
  try {
    urls = await deps.issueViewUrls(needed)
  } catch {
    urls = {}
  }
  return attachViewUrls(merged, urls)
}
