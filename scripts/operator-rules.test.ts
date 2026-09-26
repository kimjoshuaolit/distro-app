import { describe, it, expect } from 'vitest'
import { parseOperatorArgs, readOperatorEnv } from './operator-rules.ts'

describe('parseOperatorArgs', () => {
  it('takes one email, normalized', () => {
    expect(parseOperatorArgs([' Kim@Example.TEST '])).toEqual({ ok: true, email: 'kim@example.test' })
  })

  it('refuses anything else', () => {
    for (const argv of [[], ['a@example.test', 'b@example.test'], ['nope'], ['a@example'], ['a b@example.test'], ['']]) {
      expect(parseOperatorArgs(argv).ok, JSON.stringify(argv)).toBe(false)
    }
  })
})

describe('readOperatorEnv', () => {
  it('needs the Supabase URL and service role key, reporting only missing names', () => {
    expect(readOperatorEnv({ SUPABASE_URL: ' http://x ', SUPABASE_SERVICE_ROLE_KEY: 'k' })).toEqual({
      ok: true,
      value: { supabaseUrl: 'http://x', serviceRoleKey: 'k' },
    })
    expect(readOperatorEnv({ SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: '  ' })).toEqual({
      ok: false,
      missing: ['SUPABASE_SERVICE_ROLE_KEY'],
    })
    expect(readOperatorEnv({})).toEqual({ ok: false, missing: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] })
  })
})
