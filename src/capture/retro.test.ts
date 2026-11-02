import { describe, it, expect } from 'vitest'
import { RETRO, applyInstaxGrade, applyVignette, applyGrain, instaxCrop } from './retro.ts'

const px = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 255])

describe('applyInstaxGrade', () => {
  it('brightens the mids and leaves alpha alone', () => {
    const data = px(128, 128, 128)
    applyInstaxGrade(data)
    for (const v of data.slice(0, 3)) expect(v).toBeGreaterThan(140)
    expect(data[3]).toBe(255)
  })

  it('prints black as a cool, milky charcoal', () => {
    const data = px(0, 0, 0)
    applyInstaxGrade(data)
    expect(data[0]).toBeGreaterThan(10)
    expect(data[2]).toBeGreaterThan(data[0]) // blue leads in the shadows
  })

  it('blooms white to cream instead of clipping it', () => {
    const data = px(255, 255, 255)
    applyInstaxGrade(data)
    expect(data[0]).toBeGreaterThan(data[2]) // warm highlight
    expect(data[2]).toBeLessThan(255)
  })

  it('softens saturation', () => {
    const data = px(200, 60, 60)
    applyInstaxGrade(data)
    expect(data[0] - data[1]).toBeLessThan(140)
  })
})

describe('applyVignette', () => {
  it('darkens the corners more than the centre', () => {
    const w = 9
    const h = 9
    const data = new Uint8ClampedArray(w * h * 4).fill(200)
    applyVignette(data, w, h)
    const at = (x: number, y: number) => data[(y * w + x) * 4]
    expect(at(4, 4)).toBe(200)
    expect(at(0, 0)).toBeLessThan(at(4, 0))
    expect(at(0, 0)).toBeGreaterThan(200 * (1 - RETRO.vignette) - 1)
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

describe('instaxCrop', () => {
  it('trims a tall phone frame top and bottom to the Instax shape', () => {
    expect(instaxCrop(720, 1280)).toEqual({ x: 0, y: 155, w: 720, h: 970 })
  })

  it('trims the sides of a frame that is wider than the Instax shape', () => {
    const crop = instaxCrop(480, 640)
    expect(crop.h).toBe(640)
    expect(crop.w / crop.h).toBeCloseTo(RETRO.aspect, 2)
    expect(Math.abs(480 - crop.w - 2 * crop.x)).toBeLessThanOrEqual(1) // centred
  })

  it('keeps a sideways shot sideways', () => {
    const crop = instaxCrop(1280, 720)
    expect(crop.w / crop.h).toBeCloseTo(1 / RETRO.aspect, 2)
    expect(crop.h).toBe(720)
  })
})
