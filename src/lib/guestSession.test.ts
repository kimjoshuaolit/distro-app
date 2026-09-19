import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getGuestSession,
  saveGuestSession,
  clearGuestSession,
  updateRemaining,
  type GuestSession,
} from './guestSession.ts'

const sample: GuestSession = {
  eventId: 'evt-1',
  guestId: 'guest-1',
  deviceToken: 'tok-abc',
  firstName: 'Ana',
  photosRemaining: 25,
  clipsRemaining: 5,
}

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

function throwingStorage() {
  return {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
    removeItem: () => {
      throw new Error('blocked')
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('guestSession with working storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })

  it('round-trips a saved session', () => {
    saveGuestSession(sample)
    expect(getGuestSession('evt-1')).toEqual(sample)
  })

  it('returns null when nothing is stored', () => {
    expect(getGuestSession('evt-1')).toBeNull()
  })

  it('returns null when the stored eventId does not match the key', () => {
    saveGuestSession(sample)
    expect(getGuestSession('other-event')).toBeNull()
  })

  it('clears a session', () => {
    saveGuestSession(sample)
    clearGuestSession('evt-1')
    expect(getGuestSession('evt-1')).toBeNull()
  })

  it('updates remaining counts and persists them', () => {
    saveGuestSession(sample)
    const updated = updateRemaining('evt-1', { photosRemaining: 24 })
    expect(updated?.photosRemaining).toBe(24)
    expect(updated?.clipsRemaining).toBe(5) // untouched
    expect(getGuestSession('evt-1')?.photosRemaining).toBe(24)
  })

  it('updateRemaining returns null when no session exists', () => {
    expect(updateRemaining('missing', { photosRemaining: 1 })).toBeNull()
  })
})

describe('guestSession when storage throws', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', throwingStorage())
  })

  it('getGuestSession falls back to null', () => {
    expect(getGuestSession('evt-1')).toBeNull()
  })

  it('saveGuestSession swallows the error', () => {
    expect(() => saveGuestSession(sample)).not.toThrow()
  })

  it('clearGuestSession swallows the error', () => {
    expect(() => clearGuestSession('evt-1')).not.toThrow()
  })
})
