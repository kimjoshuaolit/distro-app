import { describe, it, expect } from 'vitest'
import { validateReleaseRequest } from './release-rules.ts'

const EVENT = '00000000-0000-0000-0000-000000000001'

describe('validateReleaseRequest', () => {
  it('accepts a uuid eventId with an explicit boolean, lowercasing the id', () => {
    expect(validateReleaseRequest({ eventId: EVENT, released: true })).toEqual({
      ok: true,
      value: { eventId: EVENT, released: true },
    })
    expect(validateReleaseRequest({ eventId: 'D0D0D0D0-0000-4000-8000-0000000000E1', released: false })).toEqual({
      ok: true,
      value: { eventId: 'd0d0d0d0-0000-4000-8000-0000000000e1', released: false },
    })
  })

  it('ignores extra fields (only eventId and released matter)', () => {
    expect(validateReleaseRequest({ eventId: EVENT, released: true, montageKey: 'x' })).toEqual({
      ok: true,
      value: { eventId: EVENT, released: true },
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
      [{ eventId: EVENT, released: true }],
      {},
      { eventId: EVENT },
      { released: true },
      { eventId: 'not-a-uuid', released: true },
      { eventId: 42, released: true },
      { eventId: EVENT, released: 'true' },
      { eventId: EVENT, released: 1 },
      { eventId: EVENT, released: null },
      { eventId: EVENT, released: 'toggle' },
    ]) {
      expect(validateReleaseRequest(raw)).toEqual(bad)
    }
  })
})
