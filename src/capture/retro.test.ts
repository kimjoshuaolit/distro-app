import { describe, it, expect } from 'vitest'
import { applyWarmGrade, applyGrain, formatStamp } from './retro.ts'

describe('applyWarmGrade', () => {
  it('warms a mid-gray pixel (red up, blue down) and leaves alpha alone', () => {
    const data = new Uint8ClampedArray([128, 128, 128, 255])
    applyWarmGrade(data)
    expect(data[0]).toBeGreaterThan(128) // red boosted
    expect(data[2]).toBeLessThan(128) // blue reduced
    expect(data[3]).toBe(255) // alpha untouched
  })

  it('clamps highlights at 255', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255])
    applyWarmGrade(data)
    expect(data[0]).toBe(255)
    expect(data[1]).toBe(255)
  })
})

describe('applyGrain', () => {
  it('is deterministic for a given seed', () => {
    const a = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255])
    const b = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255])
    applyGrain(a, 42)
    applyGrain(b, 42)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('differs across seeds and never leaves alpha or invalid values', () => {
    const a = new Uint8ClampedArray([100, 100, 100, 255])
    const b = new Uint8ClampedArray([100, 100, 100, 255])
    applyGrain(a, 1)
    applyGrain(b, 2)
    expect(Array.from(a.slice(0, 3))).not.toEqual(Array.from(b.slice(0, 3)))
    expect(a[3]).toBe(255)
    for (const v of a) expect(Number.isNaN(v)).toBe(false)
  })
})

describe('formatStamp', () => {
  it('formats as a disposable-camera date stamp', () => {
    expect(formatStamp(new Date(2026, 8, 19))).toBe("'26 09 19")
  })

  it('zero-pads month and day', () => {
    expect(formatStamp(new Date(2027, 0, 3))).toBe("'27 01 03")
  })
})
