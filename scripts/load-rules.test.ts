import { describe, expect, it } from 'vitest'
import {
  backoffMs,
  CLIPS,
  isLocalUrl,
  isTransient,
  parseLoadArgs,
  PHOTOS,
  readLoadEnv,
  summarize,
  verdict,
  type GuestOutcome,
} from './load-rules.ts'

const EVENT = '11111111-2222-4333-8444-555555555555'

describe('parseLoadArgs', () => {
  it('defaults to a hundred guests', () => {
    const r = parseLoadArgs([EVENT])
    expect(r).toEqual({
      ok: true,
      value: { eventId: EVENT, guests: 100, rampMs: 30_000, paceMs: 1500, photoBytes: 90 * 1024, clipBytes: 2 * 1024 * 1024, live: false },
    })
  })

  it('takes options in any order', () => {
    const r = parseLoadArgs(['--guests', '20', '--live', EVENT, '--clip-mb', '0.5', '--ramp', '0'])
    expect(r.ok && r.value).toMatchObject({ guests: 20, live: true, clipBytes: 512 * 1024, rampMs: 0 })
  })

  it('refuses a missing or malformed event id, odd numbers and unknown flags', () => {
    expect(parseLoadArgs([]).ok).toBe(false)
    expect(parseLoadArgs(['not-an-id']).ok).toBe(false)
    expect(parseLoadArgs([EVENT, '--guests', '0']).ok).toBe(false)
    expect(parseLoadArgs([EVENT, '--guests', '501']).ok).toBe(false)
    expect(parseLoadArgs([EVENT, '--guests']).ok).toBe(false)
    expect(parseLoadArgs([EVENT, '--clip-mb', 'big']).ok).toBe(false)
    expect(parseLoadArgs([EVENT, '--force']).ok).toBe(false)
    expect(parseLoadArgs([EVENT, EVENT]).ok).toBe(false)
  })
})

describe('readLoadEnv', () => {
  it('reads the app’s own VITE_ names, trimming a trailing slash', () => {
    expect(readLoadEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321/', VITE_SUPABASE_ANON_KEY: 'k' })).toEqual({
      ok: true,
      value: { supabaseUrl: 'http://127.0.0.1:54321', anonKey: 'k' },
    })
  })

  it('prefers SUPABASE_ names (the production env file)', () => {
    const r = readLoadEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'p', VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'l' })
    expect(r.ok && r.value).toEqual({ supabaseUrl: 'https://x.supabase.co', anonKey: 'p' })
  })

  it('names what is missing', () => {
    const r = readLoadEnv({ SUPABASE_URL: 'https://x.supabase.co' })
    expect(r).toEqual({ ok: false, message: 'Missing SUPABASE_ANON_KEY.' })
    expect(readLoadEnv({ SUPABASE_URL: 'nope', SUPABASE_ANON_KEY: 'k' }).ok).toBe(false)
  })
})

describe('isLocalUrl', () => {
  it('only counts this machine as local', () => {
    expect(isLocalUrl('http://127.0.0.1:54321')).toBe(true)
    expect(isLocalUrl('http://localhost:54321')).toBe(true)
    expect(isLocalUrl('https://wctenqhfrfkooyatjsyq.supabase.co')).toBe(false)
    expect(isLocalUrl('http://127.0.0.1.example.com')).toBe(false)
  })
})

describe('retry policy', () => {
  it('retries what the app retries', () => {
    expect(isTransient(undefined)).toBe(true)
    expect(isTransient(503)).toBe(true)
    expect(isTransient(429)).toBe(true)
    expect(isTransient(409)).toBe(false)
    expect(isTransient(400)).toBe(false)
  })

  it('backs off, then levels out', () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 8000])
  })
})

describe('summarize', () => {
  it('gives nearest-rank percentiles', () => {
    const s = summarize(Array.from({ length: 100 }, (_, i) => i + 1).reverse())
    expect(s).toEqual({ count: 100, p50: 50, p95: 95, max: 100 })
  })

  it('copes with no samples', () => {
    expect(summarize([])).toEqual({ count: 0, p50: 0, p95: 0, max: 0 })
  })
})

describe('verdict', () => {
  const good: GuestOutcome = {
    joined: true,
    photosSaved: PHOTOS,
    clipsSaved: CLIPS,
    extraPhoto: 'cap_reached',
    extraClip: 'cap_reached',
    retrySafe: true,
    rollCount: PHOTOS + CLIPS,
    rollOwnOnly: true,
    viewLinks: PHOTOS + CLIPS,
    viewFetched: true,
  }

  it('passes a clean run', () => {
    expect(verdict([good, good]).every((c) => c.ok)).toBe(true)
  })

  it('fails on a lost shot, an over-allotment, a double count, a leaked roll or a dead link', () => {
    const fails = (o: Partial<GuestOutcome>) => verdict([good, { ...good, ...o }]).filter((c) => !c.ok).map((c) => c.name)
    expect(fails({ joined: false })).toContain('Every guest joined')
    expect(fails({ clipsSaved: CLIPS - 1, rollCount: PHOTOS + CLIPS - 1, viewLinks: PHOTOS + CLIPS - 1 })).toEqual([
      `Every shot saved (${PHOTOS} photos + ${CLIPS} clips each)`,
    ])
    expect(fails({ extraClip: 'accepted' })).toEqual(['No one got more than their allotment'])
    expect(fails({ retrySafe: false })).toEqual(['A re-sent shot is not counted twice'])
    expect(fails({ rollOwnOnly: false })).toEqual(['Each guest sees exactly their own roll'])
    expect(fails({ viewFetched: false })).toEqual(['Saved shots can be viewed back'])
  })

  it('never passes an empty run', () => {
    expect(verdict([{ ...good, joined: false }]).some((c) => c.ok && c.name !== 'Every guest joined')).toBe(false)
  })
})
