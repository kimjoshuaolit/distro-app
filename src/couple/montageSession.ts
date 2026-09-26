// Pure state for the montage stage (2.3). No React, no DOM: the stage and its
// hook feed it events and act on what it says (fetch a link, seek, resume).
//
//   loading ─fetched(url)──▶ ready ─play──▶ playing
//      │  └─fetched(null)──▶ none
//      └──fetchFailed──────▶ failed ─retry──▶ loading
//
// The one-shot rule: a playback error (the 1-hour link lapsed mid-watch, or a
// long pause) re-signs the link ONCE and resumes at the moment it broke. A
// second failure before playback has proven the fresh link — or a failed
// re-sign — is the "didn't load" state, with a retry. Once the re-signed link
// has played on for a couple of seconds past that moment, the budget is back,
// so a very long evening with the reveal open can re-sign again later without
// a broken file ever looping on the server. A stall after the link's known
// expiry (`linkLapsed`) counts as that playback error, because browsers can
// retry a dead link for a long while before they report one.

/** Seconds of playback past the resume point that prove a re-signed link works. */
export const MONTAGE_PROVEN_SECONDS = 2

export type MontageMedia = {
  /** The signed link the `<video>` plays. */
  url: string
  /** When that link stops working (epoch ms), if the server said. */
  expiresAt: number | null
  /** This stretch of playback has spent its one re-sign. */
  resignUsed: boolean
  /** A re-sign is in flight; the element keeps its old link until it lands. */
  resigning: boolean
  /** Where to pick up once the re-signed link loads (seconds). */
  resumeAt: number
  /** It was playing when it broke, so keep playing after the resume. */
  resumePlaying: boolean
  /** A re-signed link has arrived: reload, seek to `resumeAt`, then report `resumed`. */
  resumePending: boolean
}

/**
 * `request` numbers every link fetch: a state that needs one (`needsFetch`)
 * names it, and only a result carrying that number is applied, so a stale
 * answer never lands on a newer state.
 */
export type MontageState =
  | { status: 'loading'; request: number }
  | { status: 'none'; request: number }
  | { status: 'ready'; request: number; media: MontageMedia }
  | { status: 'playing'; request: number; media: MontageMedia }
  | { status: 'failed'; request: number }

export type MontageEvent =
  /**
   * The link fetch `request` answered at `now` (epoch ms); `url: null` means
   * no montage is hosted yet. `expiresIn` is the link's lifetime in seconds.
   */
  | { type: 'fetched'; request: number; url: string | null; expiresIn?: number; now?: number }
  /** The link fetch `request` failed (network, 403, 500…). */
  | { type: 'fetchFailed'; request: number }
  /** The couple pressed the big Play. */
  | { type: 'play' }
  /** The `<video>` errored at `at` seconds; `playing` = it was not paused. */
  | { type: 'mediaError'; at: number; playing: boolean }
  /** The element reloaded the re-signed link and sought back to `resumeAt`. */
  | { type: 'resumed' }
  /** Playback reached `at` seconds. */
  | { type: 'progress'; at: number }
  /** "Try again" from the didn't-load state. */
  | { type: 'retry' }

export const initialMontageState: MontageState = { status: 'loading', request: 1 }

function freshMedia(url: string, expiresAt: number | null): MontageMedia {
  return { url, expiresAt, resignUsed: false, resigning: false, resumeAt: 0, resumePlaying: false, resumePending: false }
}

function expiryOf(event: { expiresIn?: number; now?: number }): number | null {
  const { expiresIn, now } = event
  if (typeof expiresIn !== 'number' || typeof now !== 'number') return null
  if (!Number.isFinite(expiresIn) || expiresIn <= 0 || !Number.isFinite(now)) return null
  return now + expiresIn * 1000
}

/**
 * Has the playing link lapsed? Browsers can stall for a long while retrying an
 * expired link before they report an error, so a stall past this point is
 * treated as the playback error straight away (same one-shot budget).
 */
export function linkLapsed(media: MontageMedia, now: number): boolean {
  return media.expiresAt !== null && now >= media.expiresAt
}

/** A usable playback position: finite and non-negative, else the start. */
function position(at: number): number {
  return Number.isFinite(at) && at > 0 ? at : 0
}

/** The link fetch this state is waiting on, if any. */
export function needsFetch(state: MontageState): number | null {
  if (state.status === 'loading') return state.request
  if ((state.status === 'ready' || state.status === 'playing') && state.media.resigning) return state.request
  return null
}

export function montageReducer(state: MontageState, event: MontageEvent): MontageState {
  switch (event.type) {
    case 'fetched': {
      if (event.request !== needsFetch(state)) return state
      if (event.url === null) return { status: 'none', request: state.request }
      const expiresAt = expiryOf(event)
      if (state.status === 'loading') {
        return { status: 'ready', request: state.request, media: freshMedia(event.url, expiresAt) }
      }
      if (state.status === 'ready' || state.status === 'playing') {
        return {
          ...state,
          media: { ...state.media, url: event.url, expiresAt, resigning: false, resumePending: true },
        }
      }
      return state
    }

    case 'fetchFailed':
      if (event.request !== needsFetch(state)) return state
      return { status: 'failed', request: state.request }

    case 'play':
      if (state.status !== 'ready') return state
      return { status: 'playing', request: state.request, media: state.media }

    case 'mediaError': {
      if (state.status !== 'ready' && state.status !== 'playing') return state
      const { media } = state
      if (media.resigning) return state // already re-signing: one error, one re-sign
      if (media.resignUsed) return { status: 'failed', request: state.request }
      return {
        ...state,
        request: state.request + 1,
        media: {
          ...media,
          resignUsed: true,
          resigning: true,
          resumePending: false,
          resumeAt: position(event.at),
          resumePlaying: state.status === 'playing' && event.playing,
        },
      }
    }

    case 'resumed':
      if (state.status !== 'ready' && state.status !== 'playing') return state
      if (!state.media.resumePending) return state
      return { ...state, media: { ...state.media, resumePending: false } }

    case 'progress': {
      if (state.status !== 'playing') return state
      const { media } = state
      if (!media.resignUsed || media.resigning || media.resumePending) return state
      if (position(event.at) < media.resumeAt + MONTAGE_PROVEN_SECONDS) return state
      return { ...state, media: { ...media, resignUsed: false } }
    }

    case 'retry':
      if (state.status !== 'failed') return state
      return { status: 'loading', request: state.request + 1 }
  }
}
