import { describe, it, expect } from 'vitest'
import { decideCoupleAccess } from './couple-rules.ts'

const read = (over: Partial<Parameters<typeof decideCoupleAccess>[0]> = {}) =>
  decideCoupleAccess({ hasAuthHeader: true, data: { id: 'e1' }, error: null, status: 200, ...over })

describe('decideCoupleAccess', () => {
  it('proceeds only when the caller can read the event row', () => {
    expect(read()).toBe('proceed')
  })

  it('no Authorization header → not_couple, whatever else is set', () => {
    expect(read({ hasAuthHeader: false })).toBe('not_couple')
    expect(read({ hasAuthHeader: false, data: null, error: { message: 'x' }, status: 500 })).toBe('not_couple')
  })

  it('no visible row (anon, another couple, a password session) → not_couple', () => {
    expect(read({ data: null })).toBe('not_couple')
    expect(read({ data: undefined })).toBe('not_couple')
  })

  it('a token PostgREST refuses (401/403) → not_couple', () => {
    expect(read({ data: null, error: { code: 'PGRST301' }, status: 401 })).toBe('not_couple')
    expect(read({ data: null, error: { code: '42501' }, status: 403 })).toBe('not_couple')
  })

  it('any other failed read → server_error, never a silent denial or a pass', () => {
    for (const status of [0, 400, 404, 500, 503]) {
      expect(read({ data: null, error: { message: 'boom' }, status }), String(status)).toBe('server_error')
    }
    // An error wins over a (stale) row.
    expect(read({ error: { message: 'boom' }, status: 500 })).toBe('server_error')
  })
})
