import { describe, it, expect } from 'vitest'
import { windowLine } from './windowLine'

const fmt = (iso: string) => `<${iso.slice(0, 16)}>`
const now = new Date('2026-11-14T22:00:00Z')

describe('windowLine', () => {
  it('names every phase', () => {
    expect(windowLine(null, null, now, fmt)).toEqual({ phase: 'unset', text: 'No window set — the camera isn’t open.' })
    expect(windowLine('2026-11-15T06:00:00Z', null, now, fmt)).toEqual({
      phase: 'scheduled',
      text: 'Not open yet · opens <2026-11-15T06:00>',
    })
    expect(windowLine('2026-11-14T06:00:00Z', '2026-11-15T02:00:00Z', now, fmt)).toEqual({
      phase: 'open',
      text: 'Open now · closes <2026-11-15T02:00>',
    })
    expect(windowLine('2026-11-14T06:00:00Z', null, now, fmt).text).toBe('Open now · no close time')
  })

  it('a closed window says until when late uploads still land, then that they’ve stopped', () => {
    expect(windowLine('2026-11-14T06:00:00Z', '2026-11-14T21:00:00Z', now, fmt)).toEqual({
      phase: 'closed',
      text: 'Closed <2026-11-14T21:00> · late uploads accepted until <2026-11-21T21:00>',
    })
    expect(windowLine('2026-11-01T06:00:00Z', '2026-11-01T21:00:00Z', now, fmt).text).toBe(
      'Closed <2026-11-01T21:00> · uploads have closed too',
    )
  })
})
