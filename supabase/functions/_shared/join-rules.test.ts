import { describe, it, expect } from 'vitest'
import { validateFirstName, isEventOpen, isUuid, MAX_NAME_LEN } from './join-rules.ts'

describe('validateFirstName', () => {
  it('accepts and trims a normal name', () => {
    expect(validateFirstName('  Ana  ')).toEqual({ ok: true, value: 'Ana' })
  })

  it('rejects empty and whitespace-only', () => {
    expect(validateFirstName('')).toEqual({ ok: false, error: 'invalid_name' })
    expect(validateFirstName('   ')).toEqual({ ok: false, error: 'invalid_name' })
  })

  it('rejects a name longer than the limit', () => {
    expect(validateFirstName('a'.repeat(MAX_NAME_LEN + 1))).toEqual({
      ok: false,
      error: 'invalid_name',
    })
  })

  it('accepts a name exactly at the limit', () => {
    const name = 'a'.repeat(MAX_NAME_LEN)
    expect(validateFirstName(name)).toEqual({ ok: true, value: name })
  })

  it('rejects non-strings', () => {
    expect(validateFirstName(undefined)).toEqual({ ok: false, error: 'invalid_name' })
    expect(validateFirstName(42)).toEqual({ ok: false, error: 'invalid_name' })
  })
})

describe('isEventOpen', () => {
  const now = new Date('2026-09-19T12:00:00Z')

  it('is closed when window_open is null', () => {
    expect(isEventOpen(null, null, now)).toBe(false)
  })

  it('is open when opened in the past with no close', () => {
    expect(isEventOpen('2026-09-19T11:00:00Z', null, now)).toBe(true)
  })

  it('is closed before the open time', () => {
    expect(isEventOpen('2026-09-19T13:00:00Z', null, now)).toBe(false)
  })

  it('is open within the window', () => {
    expect(isEventOpen('2026-09-19T11:00:00Z', '2026-09-19T13:00:00Z', now)).toBe(true)
  })

  it('is closed after the close time', () => {
    expect(isEventOpen('2026-09-18T10:00:00Z', '2026-09-19T11:00:00Z', now)).toBe(false)
  })

  it('is open at the exact open and close boundaries', () => {
    expect(isEventOpen('2026-09-19T12:00:00Z', null, now)).toBe(true)
    expect(isEventOpen('2026-09-19T11:00:00Z', '2026-09-19T12:00:00Z', now)).toBe(true)
  })

  it('is closed when a timestamp is unparseable', () => {
    expect(isEventOpen('not-a-date', null, now)).toBe(false)
    expect(isEventOpen('2026-09-19T11:00:00Z', 'nope', now)).toBe(false)
  })
})

describe('isUuid', () => {
  it('accepts a v4-style uuid', () => {
    expect(isUuid('00000000-0000-0000-0000-000000000001')).toBe(true)
  })

  it('rejects malformed strings and non-strings', () => {
    expect(isUuid('nope')).toBe(false)
    expect(isUuid('00000000-0000-0000-0000')).toBe(false)
    expect(isUuid(123)).toBe(false)
    expect(isUuid(null)).toBe(false)
  })
})
