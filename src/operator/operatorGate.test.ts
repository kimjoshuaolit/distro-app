import { describe, it, expect } from 'vitest'
import { isUnauthorized, operatorGate } from './operatorGate'

const me = { userId: 'u1', email: 'kim@example.test' }

describe('operatorGate', () => {
  it('waits for Auth to settle', () => {
    expect(operatorGate(undefined, { status: 'granted' }, null)).toEqual({ view: 'loading' })
  })

  it('signed out → sign-in form, carrying a failed link’s message', () => {
    expect(operatorGate(null, { status: 'checking' }, null)).toEqual({ view: 'login', linkError: null })
    expect(operatorGate(null, { status: 'granted' }, 'expired')).toEqual({ view: 'login', linkError: 'expired' })
  })

  it('signed in → the database’s answer', () => {
    expect(operatorGate(me, { status: 'checking' }, null)).toEqual({ view: 'loading' })
    expect(operatorGate(me, { status: 'granted' }, null)).toEqual({ view: 'granted' })
    expect(operatorGate(me, { status: 'denied' }, null)).toEqual({ view: 'denied' })
  })

  it('a failed check is an error screen (retry), never a grant; a rejected token waits for sign-out', () => {
    expect(operatorGate(me, { status: 'failed', unauthorized: false }, null)).toEqual({ view: 'error' })
    expect(operatorGate(me, { status: 'failed', unauthorized: true }, null)).toEqual({ view: 'loading' })
  })
})

describe('isUnauthorized', () => {
  it('401/403 sign out; network and server errors retry', () => {
    expect(isUnauthorized(401)).toBe(true)
    expect(isUnauthorized(403)).toBe(true)
    for (const s of [0, 400, 500, 503]) expect(isUnauthorized(s)).toBe(false)
  })
})
