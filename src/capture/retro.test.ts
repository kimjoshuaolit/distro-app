import { describe, it, expect } from 'vitest'
import { RETRO, instaxCrop } from './retro.ts'

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
