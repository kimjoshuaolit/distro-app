import { describe, it, expect } from 'vitest'
import { coupleGate, eventCheckFrom, shouldCheckAccess, type CoupleSession } from './coupleGate'

const couple: CoupleSession = { userId: 'u1', email: 'partner.one@example.test' }

describe('coupleGate', () => {
  it('waits while the session is still resolving', () => {
    expect(coupleGate(undefined, 'checking', null, 'exists')).toEqual({ view: 'loading' })
    expect(coupleGate(undefined, 'checking', 'expired', 'exists')).toEqual({ view: 'loading' })
  })

  it('shows the login form when signed out (anon)', () => {
    expect(coupleGate(null, 'checking', null, 'exists')).toEqual({ view: 'login', linkError: null })
  })

  it('carries an expired/used link notice onto the login form', () => {
    expect(coupleGate(null, 'checking', 'expired', 'exists')).toEqual({ view: 'login', linkError: 'expired' })
    expect(coupleGate(null, 'checking', 'invalid', 'exists')).toEqual({ view: 'login', linkError: 'invalid' })
  })

  it('waits for the access check once signed in', () => {
    expect(coupleGate(couple, 'checking', null, 'exists')).toEqual({ view: 'loading' })
  })

  it('grants the couple of this event', () => {
    expect(coupleGate(couple, 'granted', null, 'exists')).toEqual({ view: 'granted' })
  })

  it('denies a signed-in couple of another event', () => {
    expect(coupleGate(couple, 'denied', null, 'exists')).toEqual({ view: 'denied' })
  })

  it('shows the terminal error view once access has failed for good', () => {
    expect(coupleGate(couple, 'error', null, 'exists')).toEqual({ view: 'error' })
  })

  it('lets a live session win over a stale link error', () => {
    expect(coupleGate(couple, 'granted', 'expired', 'exists')).toEqual({ view: 'granted' })
    expect(coupleGate(couple, 'denied', 'invalid', 'exists')).toEqual({ view: 'denied' })
  })

  describe('event validation', () => {
    it('a malformed id is notFound, signed out or in — never a login form', () => {
      expect(coupleGate(undefined, 'checking', null, 'malformed')).toEqual({ view: 'notFound' })
      expect(coupleGate(null, 'checking', 'expired', 'malformed')).toEqual({ view: 'notFound' })
      expect(coupleGate(couple, 'denied', null, 'malformed')).toEqual({ view: 'notFound' })
    })

    it('an unknown event is notFound instead of login (signed out) or "another couple" (signed in)', () => {
      expect(coupleGate(null, 'checking', null, 'missing')).toEqual({ view: 'notFound' })
      expect(coupleGate(couple, 'denied', null, 'missing')).toEqual({ view: 'notFound' })
    })

    it('waits for the event check before showing a login form', () => {
      expect(coupleGate(null, 'checking', null, 'checking')).toEqual({ view: 'loading' })
      expect(coupleGate(couple, 'granted', null, 'checking')).toEqual({ view: 'loading' })
    })

    it('a transient event-check failure carries on (RLS still decides access)', () => {
      expect(coupleGate(null, 'checking', null, 'unknown')).toEqual({ view: 'login', linkError: null })
      expect(coupleGate(couple, 'granted', null, 'unknown')).toEqual({ view: 'granted' })
    })

    it('maps event_status onto the event check', () => {
      expect(eventCheckFrom({ state: 'open' })).toBe('exists')
      expect(eventCheckFrom({ state: 'pending', opensAt: null })).toBe('exists')
      expect(eventCheckFrom({ state: 'ended' })).toBe('exists')
      expect(eventCheckFrom({ state: 'invalid' })).toBe('missing')
      expect(eventCheckFrom({ state: 'error' })).toBe('unknown')
    })

    it('only checks access for an event that exists (or might)', () => {
      expect(shouldCheckAccess('exists')).toBe(true)
      expect(shouldCheckAccess('unknown')).toBe(true)
      expect(shouldCheckAccess('malformed')).toBe(false)
      expect(shouldCheckAccess('missing')).toBe(false)
      expect(shouldCheckAccess('checking')).toBe(false)
    })
  })
})
