import { describe, it, expect } from 'vitest'
import {
  mapSetWindowError,
  UPLOAD_GRACE_DAYS,
  uploadsUntil,
  validateSetWindowRequest,
  windowPhase,
} from './window-rules.ts'

const EVENT = '00000000-0000-0000-0000-000000000001'

describe('validateSetWindowRequest', () => {
  it('accepts open/close for a uuid (lowercased)', () => {
    expect(validateSetWindowRequest({ eventId: EVENT, action: 'open' })).toEqual({
      ok: true,
      value: { eventId: EVENT, action: 'open' },
    })
    expect(validateSetWindowRequest({ eventId: 'D0D0D0D0-0000-4000-8000-0000000000E1', action: 'close' })).toEqual({
      ok: true,
      value: { eventId: 'd0d0d0d0-0000-4000-8000-0000000000e1', action: 'close' },
    })
  })

  it('refuses anything else', () => {
    for (const raw of [
      null,
      'x',
      [],
      {},
      { eventId: EVENT },
      { action: 'open' },
      { eventId: 'nope', action: 'open' },
      { eventId: EVENT, action: 'toggle' },
      { eventId: EVENT, action: 'OPEN' },
      { eventId: EVENT, action: true },
    ]) {
      expect(validateSetWindowRequest(raw), JSON.stringify(raw)).toEqual({ ok: false, error: 'bad_request' })
    }
  })
})

describe('mapSetWindowError', () => {
  it('unknown event → 404; bad action → 400; else 500', () => {
    expect(mapSetWindowError('P0002')).toMatchObject({ status: 404, code: 'not_found' })
    expect(mapSetWindowError('22023')).toMatchObject({ status: 400, code: 'bad_request' })
    for (const c of ['42501', undefined, 7]) expect(mapSetWindowError(c)).toMatchObject({ status: 500, code: 'server_error' })
  })
})

describe('windowPhase', () => {
  const now = new Date('2026-11-14T12:00:00Z')
  it('unset without an open time', () => {
    expect(windowPhase(null, null, now)).toBe('unset')
    expect(windowPhase('junk', null, now)).toBe('unset')
  })
  it('scheduled before open, open inside, closed after close', () => {
    expect(windowPhase('2026-11-14T13:00:00Z', '2026-11-14T20:00:00Z', now)).toBe('scheduled')
    expect(windowPhase('2026-11-14T06:00:00Z', '2026-11-14T20:00:00Z', now)).toBe('open')
    expect(windowPhase('2026-11-14T06:00:00Z', '2026-11-14T11:59:59Z', now)).toBe('closed')
  })
  it('the close instant itself is still open (same as event_status: now <= close)', () => {
    expect(windowPhase('2026-11-14T06:00:00Z', '2026-11-14T12:00:00Z', now)).toBe('open')
  })
  it('an unset close never closes', () => {
    expect(windowPhase('2026-11-14T06:00:00Z', null, now)).toBe('open')
  })
})

describe('uploadsUntil', () => {
  it(`is ${UPLOAD_GRACE_DAYS} days after the close`, () => {
    expect(UPLOAD_GRACE_DAYS).toBe(7)
    expect(uploadsUntil('2026-11-15T02:00:00Z')).toBe('2026-11-22T02:00:00.000Z')
  })
  it('null when the window never closes', () => {
    expect(uploadsUntil(null)).toBeNull()
    expect(uploadsUntil('junk')).toBeNull()
  })
})
