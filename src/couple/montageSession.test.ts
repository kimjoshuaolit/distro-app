import { describe, it, expect } from 'vitest'
import {
  initialMontageState,
  linkLapsed,
  montageReducer,
  needsFetch,
  MONTAGE_PROVEN_SECONDS,
  type MontageEvent,
  type MontageState,
} from './montageSession'

const run = (events: MontageEvent[], from: MontageState = initialMontageState) =>
  events.reduce(montageReducer, from)

const ready = run([{ type: 'fetched', request: 1, url: 'https://r2/m?sig=1' }])
const playing = montageReducer(ready, { type: 'play' })

describe('loading the montage link', () => {
  it('starts loading, asking for fetch #1', () => {
    expect(initialMontageState).toEqual({ status: 'loading', request: 1 })
    expect(needsFetch(initialMontageState)).toBe(1)
  })

  it('a hosted montage → ready with the link, nothing more to fetch', () => {
    expect(ready).toMatchObject({ status: 'ready', media: { url: 'https://r2/m?sig=1', resignUsed: false } })
    expect(needsFetch(ready)).toBeNull()
  })

  it('no montage yet → none (the gentle "being prepared" state)', () => {
    const s = run([{ type: 'fetched', request: 1, url: null }])
    expect(s.status).toBe('none')
    expect(needsFetch(s)).toBeNull()
  })

  it('a failed fetch → failed; retry goes back to loading with a new request', () => {
    const failed = run([{ type: 'fetchFailed', request: 1 }])
    expect(failed.status).toBe('failed')
    const again = montageReducer(failed, { type: 'retry' })
    expect(again).toEqual({ status: 'loading', request: 2 })
    expect(needsFetch(again)).toBe(2)
    expect(run([{ type: 'fetched', request: 2, url: 'https://r2/m' }], again).status).toBe('ready')
  })

  it('a stale answer (older request) never lands', () => {
    const again = run([{ type: 'fetchFailed', request: 1 }, { type: 'retry' }])
    expect(montageReducer(again, { type: 'fetched', request: 1, url: 'https://old' })).toBe(again)
    expect(montageReducer(again, { type: 'fetchFailed', request: 1 })).toBe(again)
  })

  it('answers nobody is waiting for are ignored', () => {
    expect(montageReducer(ready, { type: 'fetched', request: 1, url: 'https://other' })).toBe(ready)
    expect(montageReducer(ready, { type: 'fetchFailed', request: 1 })).toBe(ready)
  })
})

describe('playing', () => {
  it('Play moves ready → playing with the same link', () => {
    expect(playing).toMatchObject({ status: 'playing', media: { url: 'https://r2/m?sig=1' } })
  })

  it('Play does nothing outside ready', () => {
    for (const s of [initialMontageState, run([{ type: 'fetched', request: 1, url: null }]), playing]) {
      expect(montageReducer(s, { type: 'play' })).toBe(s)
    }
  })

  it('retry does nothing outside failed', () => {
    expect(montageReducer(playing, { type: 'retry' })).toBe(playing)
    expect(montageReducer(ready, { type: 'retry' })).toBe(ready)
  })
})

describe('expired mid-watch: re-sign once, resume at the same time', () => {
  const broke = montageReducer(playing, { type: 'mediaError', at: 42.5, playing: true })

  it('the first playback error asks for a fresh link and remembers where it was', () => {
    expect(broke).toMatchObject({
      status: 'playing',
      request: 2,
      media: { url: 'https://r2/m?sig=1', resigning: true, resignUsed: true, resumeAt: 42.5, resumePlaying: true },
    })
    expect(needsFetch(broke)).toBe(2)
  })

  it('more errors while re-signing are the same failure, not a second one', () => {
    expect(montageReducer(broke, { type: 'mediaError', at: 43, playing: false })).toBe(broke)
  })

  it('the fresh link lands with a resume pending; resumed clears it', () => {
    const fresh = montageReducer(broke, { type: 'fetched', request: 2, url: 'https://r2/m?sig=2' })
    expect(fresh).toMatchObject({
      status: 'playing',
      media: { url: 'https://r2/m?sig=2', resigning: false, resumePending: true, resumeAt: 42.5 },
    })
    expect(needsFetch(fresh)).toBeNull()
    const resumed = montageReducer(fresh, { type: 'resumed' })
    expect(resumed).toMatchObject({ status: 'playing', media: { resumePending: false } })
    expect(montageReducer(resumed, { type: 'resumed' })).toBe(resumed)
  })

  it('a second failure (the fresh link errors too) → failed', () => {
    const s = run(
      [{ type: 'fetched', request: 2, url: 'https://r2/m?sig=2' }, { type: 'mediaError', at: 42.5, playing: true }],
      broke,
    )
    expect(s.status).toBe('failed')
  })

  it('a failed re-sign → failed', () => {
    expect(montageReducer(broke, { type: 'fetchFailed', request: 2 }).status).toBe('failed')
  })

  it('the montage vanishing during a re-sign → none', () => {
    expect(montageReducer(broke, { type: 'fetched', request: 2, url: null }).status).toBe('none')
  })

  it('keeps the paused/playing intent, and a paused stage stays paused', () => {
    expect(montageReducer(playing, { type: 'mediaError', at: 10, playing: false })).toMatchObject({
      media: { resumePlaying: false },
    })
  })

  it('an unusable position resumes from the start', () => {
    for (const at of [Number.NaN, -3, Number.POSITIVE_INFINITY]) {
      expect(montageReducer(playing, { type: 'mediaError', at, playing: true })).toMatchObject({
        media: { resumeAt: 0 },
      })
    }
  })

  it('an error on the idle stage re-signs too, but never starts playback', () => {
    const s = montageReducer(ready, { type: 'mediaError', at: 0, playing: true })
    expect(s).toMatchObject({ status: 'ready', media: { resigning: true, resumePlaying: false } })
  })

  it('errors do nothing when there is no media', () => {
    for (const s of [initialMontageState, run([{ type: 'fetchFailed', request: 1 }])]) {
      expect(montageReducer(s, { type: 'mediaError', at: 1, playing: true })).toBe(s)
    }
  })
})

describe('link expiry', () => {
  const T0 = 1_000_000

  it('records when the link lapses, from expiresIn at fetch time', () => {
    const s = run([{ type: 'fetched', request: 1, url: 'u', expiresIn: 3600, now: T0 }])
    expect(s).toMatchObject({ media: { expiresAt: T0 + 3_600_000 } })
    if (s.status !== 'ready') throw new Error('expected ready')
    expect(linkLapsed(s.media, T0 + 3_599_999)).toBe(false)
    expect(linkLapsed(s.media, T0 + 3_600_000)).toBe(true)
  })

  it('an unknown lifetime never counts as lapsed (only a real error re-signs)', () => {
    for (const extra of [{}, { expiresIn: 0, now: T0 }, { expiresIn: 3600 }, { expiresIn: Number.NaN, now: T0 }]) {
      const s = run([{ type: 'fetched', request: 1, url: 'u', ...extra }])
      if (s.status !== 'ready') throw new Error('expected ready')
      expect(s.media.expiresAt, JSON.stringify(extra)).toBeNull()
      expect(linkLapsed(s.media, Number.MAX_SAFE_INTEGER)).toBe(false)
    }
  })

  it('a re-signed link carries its own, later expiry', () => {
    const s = run(
      [
        { type: 'fetched', request: 1, url: 'u1', expiresIn: 3600, now: T0 },
        { type: 'play' },
        { type: 'mediaError', at: 12, playing: true },
        { type: 'fetched', request: 2, url: 'u2', expiresIn: 3600, now: T0 + 4_000_000 },
      ],
      initialMontageState,
    )
    expect(s).toMatchObject({ status: 'playing', media: { url: 'u2', expiresAt: T0 + 7_600_000 } })
  })
})

describe('the re-sign budget comes back once the fresh link has proven itself', () => {
  const resumed = run(
    [
      { type: 'mediaError', at: 100, playing: true },
      { type: 'fetched', request: 2, url: 'https://r2/m?sig=2' },
      { type: 'resumed' },
    ],
    playing,
  )

  it('progress short of the proof window keeps the budget spent', () => {
    const s = montageReducer(resumed, { type: 'progress', at: 100 + MONTAGE_PROVEN_SECONDS - 0.5 })
    expect(s).toBe(resumed)
    expect(montageReducer(s, { type: 'mediaError', at: 101, playing: true }).status).toBe('failed')
  })

  it('progress past it restores one more re-sign (a later lapse can re-sign again)', () => {
    const s = montageReducer(resumed, { type: 'progress', at: 100 + MONTAGE_PROVEN_SECONDS })
    expect(s).toMatchObject({ media: { resignUsed: false } })
    const later = montageReducer(s, { type: 'mediaError', at: 3700, playing: true })
    expect(later).toMatchObject({ status: 'playing', request: 3, media: { resigning: true, resumeAt: 3700 } })
  })

  it('progress before the resume has happened proves nothing', () => {
    const pending = run([{ type: 'mediaError', at: 5, playing: true }, { type: 'fetched', request: 2, url: 'u2' }], playing)
    expect(montageReducer(pending, { type: 'progress', at: 60 })).toBe(pending)
  })

  it('progress without a spent budget changes nothing', () => {
    expect(montageReducer(playing, { type: 'progress', at: 30 })).toBe(playing)
  })
})
