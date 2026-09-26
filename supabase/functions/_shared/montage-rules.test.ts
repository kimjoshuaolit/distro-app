import { describe, it, expect } from 'vitest'
import { MONTAGE_TTL_SECONDS, validateMontageRequest } from './montage-rules.ts'
import { withExpiry } from './view-rules.ts'

const EVENT = '00000000-0000-0000-0000-000000000001'

describe('montage URL lifetime (AD-2)', () => {
  it('the montage link lives at most 1 hour', () => {
    expect(MONTAGE_TTL_SECONDS).toBe(3600)
  })

  it('is a TTL withExpiry accepts, and lands as X-Amz-Expires', () => {
    const url = new URL(withExpiry('https://acct.r2.cloudflarestorage.com/b/events/e/montage/x.mp4', MONTAGE_TTL_SECONDS))
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600')
  })
})

describe('validateMontageRequest', () => {
  it('accepts a uuid eventId and lowercases it', () => {
    expect(validateMontageRequest({ eventId: EVENT })).toEqual({ ok: true, value: { eventId: EVENT } })
    expect(validateMontageRequest({ eventId: 'D0D0D0D0-0000-4000-8000-0000000000E1' })).toEqual({
      ok: true,
      value: { eventId: 'd0d0d0d0-0000-4000-8000-0000000000e1' },
    })
  })

  it('ignores extra fields (only eventId matters)', () => {
    expect(validateMontageRequest({ eventId: EVENT, montageKey: 'events/x' })).toEqual({
      ok: true,
      value: { eventId: EVENT },
    })
  })

  it('refuses anything else with bad_request', () => {
    const bad = { ok: false, error: 'bad_request' }
    for (const raw of [
      null,
      undefined,
      'x',
      42,
      [],
      [EVENT],
      {},
      { eventId: '' },
      { eventId: 'not-a-uuid' },
      { eventId: 123 },
      { eventId: `${EVENT} ` },
      { event_id: EVENT },
    ]) {
      expect(validateMontageRequest(raw), JSON.stringify(raw)).toEqual(bad)
    }
  })
})
