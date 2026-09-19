// Opaque guest identity, stored per-event in localStorage. Every access is
// guarded — private mode / blocked storage must not break the join flow.

export type GuestSession = {
  eventId: string
  guestId: string
  deviceToken: string
  firstName: string
  photosRemaining: number
  clipsRemaining: number
}

const keyFor = (eventId: string) => `drc.guest.${eventId}`

export function getGuestSession(eventId: string): GuestSession | null {
  try {
    const raw = localStorage.getItem(keyFor(eventId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as GuestSession
    if (!parsed || parsed.eventId !== eventId || !parsed.deviceToken) return null
    return parsed
  } catch {
    return null
  }
}

export function saveGuestSession(session: GuestSession): void {
  try {
    localStorage.setItem(keyFor(session.eventId), JSON.stringify(session))
  } catch {
    // Storage unavailable — the session still works for this page load.
  }
}

export function clearGuestSession(eventId: string): void {
  try {
    localStorage.removeItem(keyFor(eventId))
  } catch {
    // ignore
  }
}
