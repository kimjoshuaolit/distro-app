import { describe, it, expect } from 'vitest'
import { decideOperatorAccess, mapSaveError, validateSaveEventRequest } from './operator-rules.ts'

const EVENT = '00000000-0000-0000-0000-000000000001'
const good = {
  coupleNames: 'Ana & Ben',
  windowOpen: '2026-11-14T06:00:00.000Z',
  windowClose: '2026-11-14T18:00:00.000Z',
  coupleEmails: ['ana@example.test', 'ben@example.test'],
}

describe('decideOperatorAccess', () => {
  it('proceeds only when is_operator() answered true', () => {
    expect(decideOperatorAccess({ hasAuthHeader: true, data: true, error: null, status: 200 })).toBe('proceed')
    for (const data of [false, null, 'true', 1, {}]) {
      expect(decideOperatorAccess({ hasAuthHeader: true, data, error: null, status: 200 })).toBe('not_operator')
    }
  })

  it('no Authorization header is never the operator, whatever else came back', () => {
    expect(decideOperatorAccess({ hasAuthHeader: false, data: true, error: null, status: 200 })).toBe('not_operator')
  })

  it('a refused token is not_operator; any other failure is a server_error', () => {
    const error = { message: 'x' }
    expect(decideOperatorAccess({ hasAuthHeader: true, data: null, error, status: 401 })).toBe('not_operator')
    expect(decideOperatorAccess({ hasAuthHeader: true, data: null, error, status: 403 })).toBe('not_operator')
    expect(decideOperatorAccess({ hasAuthHeader: true, data: null, error, status: 500 })).toBe('server_error')
    expect(decideOperatorAccess({ hasAuthHeader: true, data: true, error, status: 0 })).toBe('server_error')
  })
})

describe('mapSaveError', () => {
  it('unknown event → 404 not_found on eventId', () => {
    expect(mapSaveError('P0002')).toEqual({
      status: 404,
      code: 'not_found',
      message: 'That event doesn’t exist.',
      field: 'eventId',
    })
  })

  it('a constraint backstop → 400 bad_request (still the caller’s input)', () => {
    expect(mapSaveError('23514')).toMatchObject({ status: 400, code: 'bad_request', field: 'body' })
  })

  it('anything else → 500 server_error, no field', () => {
    for (const code of ['42501', '23505', undefined, null, 42]) {
      expect(mapSaveError(code)).toEqual({ status: 500, code: 'server_error', message: 'Could not save the event.' })
    }
  })
})

describe('validateSaveEventRequest', () => {
  it('accepts a new event, trimming names and normalizing emails and times', () => {
    const r = validateSaveEventRequest({
      ...good,
      coupleNames: '  Ana & Ben ',
      windowOpen: '2026-11-14T14:00:00+08:00',
      coupleEmails: [' Ana@Example.TEST '],
    })
    expect(r).toEqual({
      ok: true,
      value: {
        eventId: null,
        coupleNames: 'Ana & Ben',
        windowOpen: '2026-11-14T06:00:00.000Z',
        windowClose: '2026-11-14T18:00:00.000Z',
        coupleEmails: ['ana@example.test'],
      },
    })
  })

  it('accepts an edit (uuid lowercased) and zero emails', () => {
    const r = validateSaveEventRequest({ ...good, eventId: EVENT.toUpperCase(), coupleEmails: [] })
    expect(r).toMatchObject({ ok: true, value: { eventId: EVENT, coupleEmails: [] } })
    expect(validateSaveEventRequest({ ...good, eventId: null })).toMatchObject({ ok: true, value: { eventId: null } })
  })

  it('names: 1–80 characters after trimming', () => {
    expect(validateSaveEventRequest({ ...good, coupleNames: 'x'.repeat(80) }).ok).toBe(true)
    for (const coupleNames of ['', '   ', 'x'.repeat(81), 42, undefined]) {
      expect(validateSaveEventRequest({ ...good, coupleNames })).toMatchObject({ ok: false, field: 'coupleNames' })
    }
  })

  it('window: both ISO timestamps, close strictly after open', () => {
    for (const patch of [
      { windowOpen: '' },
      { windowOpen: 'tomorrow' },
      { windowOpen: '2026-11-14' },
      { windowOpen: '2026-13-40T99:99Z' },
      { windowOpen: '2026-11-14T06:00' }, // no zone: would be read in the runtime's zone
      { windowOpen: '2026-11-14T06:00:00.000' },
      { windowOpen: '2026-11-14T06:00:00Zjunk' },
      { windowClose: undefined },
      { windowClose: 1790000000000 },
      { windowClose: good.windowOpen },
      { windowClose: '2026-11-14T05:59:59.000Z' },
    ]) {
      expect(validateSaveEventRequest({ ...good, ...patch }), JSON.stringify(patch)).toMatchObject({
        ok: false,
        field: 'window',
      })
    }
  })

  it('emails: at most two, valid, distinct after normalizing', () => {
    for (const coupleEmails of [
      ['a@example.test', 'b@example.test', 'c@example.test'],
      ['not-an-email'],
      ['a@example'],
      ['a b@example.test'],
      ['a@example.test', ' A@EXAMPLE.test'],
      [42],
      'a@example.test',
      undefined,
    ]) {
      expect(validateSaveEventRequest({ ...good, coupleEmails }), JSON.stringify(coupleEmails)).toMatchObject({
        ok: false,
        field: 'coupleEmails',
      })
    }
  })

  it('refuses a malformed body or event id', () => {
    for (const raw of [null, undefined, 'x', 42, [], [good]]) {
      expect(validateSaveEventRequest(raw)).toMatchObject({ ok: false, field: 'body' })
    }
    for (const eventId of ['nope', 42, '']) {
      expect(validateSaveEventRequest({ ...good, eventId })).toMatchObject({ ok: false, field: 'eventId' })
    }
  })

  it('ignores unknown fields (e.g. a smuggled released flag)', () => {
    const r = validateSaveEventRequest({ ...good, released: true, montageKey: 'x' })
    expect(r.ok && Object.keys(r.value).sort()).toEqual(
      ['coupleEmails', 'coupleNames', 'eventId', 'windowClose', 'windowOpen'].sort(),
    )
  })
})
