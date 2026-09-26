import type { Collection, CollectionGuest, CollectionShot } from '../lib/api'

// Pure shaping of the couple's collection (2.2): rows in, a shelf of rolls out.

/** One shot on a roll's contact sheet, numbered 1… in capture order. */
export type CollectionFrame = {
  id: string // shots.id — what issue-couple-view-urls signs
  frame: number
  type: 'photo' | 'clip'
  capturedAt: string | null
}

/** One guest's roll on the shelf. */
export type CoupleRoll = {
  guestId: string
  firstName: string
  label: string // "Rosa’s roll", or "Ana’s roll · 2" for a second Ana
  photos: number
  clips: number
  cover: CollectionFrame // first photo, else first clip
  frames: CollectionFrame[]
}

// Names compare case-insensitively but keep accents apart ("Ana" = "ana" ≠ "Ána").
const names = new Intl.Collator(undefined, { sensitivity: 'accent' })

/** Parse an ISO time; unknown or garbled → +∞ so it sorts last, never NaN. */
function timeOf(iso: string | null): number {
  const t = iso ? Date.parse(iso) : Number.NaN
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

/** Earlier first, unknown last, ties on id for a stable order. */
function byTimeThenId(ta: number, tb: number, a: string, b: string): number {
  if (ta !== tb) return ta < tb ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

function displayName(guest: CollectionGuest): string {
  return guest.firstName.trim() || 'A guest'
}

/** "12 photos · 2 clips", "1 photo", "3 clips" — empty kinds are left out. */
export function countLabel(photos: number, clips: number): string {
  const parts: string[] = []
  if (photos > 0) parts.push(`${photos} ${photos === 1 ? 'photo' : 'photos'}`)
  if (clips > 0) parts.push(`${clips} ${clips === 1 ? 'clip' : 'clips'}`)
  return parts.join(' · ')
}

/**
 * What to sign right now — nothing before it's needed: the covers while the
 * shelf is open, or just the open roll's shots (none for an unknown roll).
 */
export function idsToSign(rolls: CoupleRoll[], openGuestId: string | null): string[] {
  if (openGuestId === null) return rolls.map((r) => r.cover.id)
  return rolls.find((r) => r.guestId === openGuestId)?.frames.map((f) => f.id) ?? []
}

/** Split ids into request-sized batches (the function takes at most 30). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Group uploaded shots into one roll per guest. Guests with nothing uploaded
 * are left off the shelf; shots of unknown guests are ignored. Rolls sort A–Z
 * by first name, then by join order. A repeated first name gets " · 2", " · 3"
 * by join order among ALL the event's guests with that name — including ones
 * with nothing uploaded yet — so a label never changes when an earlier
 * namesake's shots arrive later. Frames are in capture order and numbered like
 * a contact sheet.
 */
export function buildCollection({ guests, shots }: Collection): CoupleRoll[] {
  const byGuest = new Map<string, CollectionShot[]>()
  for (const g of guests) byGuest.set(g.id, [])
  for (const s of shots) byGuest.get(s.guestId)?.push(s)

  // Everyone, A–Z then join order: namesake numbers are handed out here, before
  // anyone is hidden, so hidden guests still hold their number.
  const joined = guests
    .map((g) => ({ guest: g, name: displayName(g), joinedAt: timeOf(g.createdAt) }))
    .sort(
      (a, b) =>
        names.compare(a.name, b.name) || byTimeThenId(a.joinedAt, b.joinedAt, a.guest.id, b.guest.id),
    )

  let previous: string | null = null
  let repeat = 0
  const numbered = joined.map((entry) => {
    repeat = previous !== null && names.compare(previous, entry.name) === 0 ? repeat + 1 : 1
    previous = entry.name
    return { ...entry, repeat }
  })

  return numbered
    .filter(({ guest }) => (byGuest.get(guest.id)?.length ?? 0) > 0)
    .map(({ guest, name, repeat }): CoupleRoll => {
      const frames = (byGuest.get(guest.id) ?? [])
        .map((s) => ({ s, t: timeOf(s.capturedAt) }))
        .sort((a, b) => byTimeThenId(a.t, b.t, a.s.id, b.s.id))
        .map(({ s }, i): CollectionFrame => ({ id: s.id, frame: i + 1, type: s.type, capturedAt: s.capturedAt }))
      const photos = frames.filter((f) => f.type === 'photo').length

      return {
        guestId: guest.id,
        firstName: name,
        label: repeat > 1 ? `${name}’s roll · ${repeat}` : `${name}’s roll`,
        photos,
        clips: frames.length - photos,
        cover: frames.find((f) => f.type === 'photo') ?? frames[0],
        frames,
      }
    })
}
