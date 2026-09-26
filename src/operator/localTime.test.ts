import { describe, it, expect } from 'vitest'
import { formatWindow, isoToLocalInput, localInputToIso, localZoneName } from './localTime'

describe('isoToLocalInput / localInputToIso', () => {
  it('round-trips a local datetime-local value through UTC', () => {
    for (const local of ['2026-11-14T14:00', '2026-01-01T00:00', '2026-12-31T23:59']) {
      const iso = localInputToIso(local)
      expect(iso).toMatch(/Z$/)
      expect(isoToLocalInput(iso)).toBe(local)
    }
  })

  it('stores the same instant the local input names', () => {
    const iso = localInputToIso('2026-11-14T14:00')!
    const d = new Date(iso)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 14, 14, 0])
  })

  it('shows a stored UTC time in local time, formatted for the input', () => {
    const iso = new Date(2026, 10, 14, 9, 5).toISOString()
    expect(isoToLocalInput(iso)).toBe('2026-11-14T09:05')
  })

  it('empty or invalid values', () => {
    expect(isoToLocalInput(null)).toBe('')
    expect(isoToLocalInput('')).toBe('')
    expect(isoToLocalInput('nope')).toBe('')
    for (const v of ['', '2026-11-14', 'tomorrow', '2026-11-14 14:00', '2026-13-40T99:99']) {
      expect(localInputToIso(v), v).toBeNull()
    }
  })
})

describe('localInputToIso — DST gaps', () => {
  it('refuses a local time that doesn’t exist in this zone', () => {
    // Build a candidate from real transitions only when this zone has DST; a
    // zone without DST has no gaps, so every valid minute must round-trip.
    const jan = new Date(2026, 0, 1).getTimezoneOffset()
    const jul = new Date(2026, 6, 1).getTimezoneOffset()
    if (jan === jul) {
      expect(localInputToIso('2026-03-08T02:30')).not.toBeNull()
      return
    }
    // Scan 2026 for an hour-long gap (a spring-forward day) and try inside it.
    for (let day = new Date(2026, 0, 1); day.getFullYear() === 2026; day.setDate(day.getDate() + 1)) {
      const next = new Date(day)
      next.setDate(day.getDate() + 1)
      if (next.getTimezoneOffset() < day.getTimezoneOffset()) {
        let found = false
        for (let h = 0; h < 24 && !found; h++) {
          const v = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}T${String(h).padStart(2, '0')}:30`
          if (localInputToIso(v) === null) found = true
        }
        expect(found).toBe(true)
        return
      }
    }
  })
})

describe('localZoneName', () => {
  it('names a zone', () => {
    expect(localZoneName().length).toBeGreaterThan(0)
  })
})

describe('formatWindow', () => {
  it('says so when no window is set', () => {
    expect(formatWindow(null, null)).toBe('No window set')
    expect(formatWindow('2026-11-14T06:00:00Z', 'x')).toBe('No window set')
  })

  it('shows open → close', () => {
    expect(formatWindow('2026-11-14T06:00:00Z', '2026-11-14T18:00:00Z', 'en-US')).toContain('→')
  })
})
