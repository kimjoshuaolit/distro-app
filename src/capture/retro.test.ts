import { describe, it, expect } from 'vitest'
import {
  LUT_BYTES,
  LUT_SIZE,
  RETRO,
  aberrate,
  boxBlur,
  developFilm,
  exposureFor,
  instaxCrop,
  radius,
  sampleLut,
  shoulder,
} from './retro.ts'

/** A LUT that maps every colour to itself. */
function identityLut(): Uint8Array {
  const lut = new Uint8Array(LUT_BYTES)
  const n = LUT_SIZE - 1
  for (let b = 0; b < LUT_SIZE; b++)
    for (let g = 0; g < LUT_SIZE; g++)
      for (let r = 0; r < LUT_SIZE; r++) {
        const i = ((b * LUT_SIZE + g) * LUT_SIZE + r) * 3
        lut[i] = Math.round((r / n) * 255)
        lut[i + 1] = Math.round((g / n) * 255)
        lut[i + 2] = Math.round((b / n) * 255)
      }
  return lut
}

function frame(w: number, h: number, rgb: [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i)
  return data
}

const mean = (data: Uint8ClampedArray, c: number) => {
  let sum = 0
  for (let i = c; i < data.length; i += 4) sum += data[i]
  return sum / (data.length / 4)
}

describe('sampleLut', () => {
  it('passes colours straight through an identity LUT, between grid points too', () => {
    const out = [0, 0, 0]
    sampleLut(identityLut(), 0.3, 0.55, 0.9, out)
    expect(out[0]).toBeCloseTo(0.3, 2)
    expect(out[1]).toBeCloseTo(0.55, 2)
    expect(out[2]).toBeCloseTo(0.9, 2)
  })

  it('reads the right corner: the blue axis is slowest', () => {
    const lut = new Uint8Array(LUT_BYTES)
    lut.set([10, 20, 30], LUT_BYTES - 3) // white maps to a dark blue-grey
    const out = [0, 0, 0]
    sampleLut(lut, 1, 1, 1, out)
    expect(out.map((v) => Math.round(v * 255))).toEqual([10, 20, 30])
  })

  it('clamps colours outside 0-1', () => {
    const out = [0, 0, 0]
    sampleLut(identityLut(), -0.5, 1.5, 0.5, out)
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(1)
  })
})

describe('boxBlur', () => {
  it('keeps a flat image flat, edges included', () => {
    const src = new Float32Array(5 * 4 * 3).fill(0.4)
    for (const v of boxBlur(src, 5, 4, 2)) expect(v).toBeCloseTo(0.4, 6)
  })

  it('spreads a bright point and keeps its energy', () => {
    const w = 21
    const src = new Float32Array(w * w * 3)
    src[(10 * w + 10) * 3] = 1
    const out = boxBlur(src, w, w, 2)
    let total = 0
    for (let i = 0; i < out.length; i += 3) total += out[i]
    expect(total).toBeCloseTo(1, 4)
    expect(out[(10 * w + 10) * 3]).toBeLessThan(0.2)
    expect(out[(10 * w + 12) * 3]).toBeGreaterThan(0)
    expect(out[(10 * w + 10) * 3 + 1]).toBe(0) // other channels untouched
  })

  it('never blurs by less than a pixel', () => {
    expect(radius(0.0015, 100)).toBe(1)
    expect(radius(0.02, 800)).toBe(16)
  })
})

describe('aberrate', () => {
  it('leaves the centre alone and the blue channel exact', () => {
    const w = 101
    const src = new Float32Array(w * w * 3).map((_, i) => (i % 7) / 7)
    const out = aberrate(src, w, w)
    const c = (50 * w + 50) * 3
    expect(out[c]).toBeCloseTo(src[c], 5)
    for (let i = 2; i < src.length; i += 3) expect(out[i]).toBe(src[i])
  })
})

describe('developFilm', () => {
  it('is deterministic for a given seed and leaves alpha alone', () => {
    const a = frame(24, 32, [120, 100, 90])
    const b = frame(24, 32, [120, 100, 90])
    developFilm(a, 24, 32, identityLut(), 7)
    developFilm(b, 24, 32, identityLut(), 7)
    expect(Array.from(a)).toEqual(Array.from(b))
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255)
  })

  it('grains differently per shot', () => {
    const a = frame(24, 32, [120, 100, 90])
    const b = frame(24, 32, [120, 100, 90])
    developFilm(a, 24, 32, null, 1)
    developFilm(b, 24, 32, null, 2)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  it('runs bright in an ordinary dim room, like instant film', () => {
    const data = frame(40, 40, [70, 70, 70])
    developFilm(data, 40, 40, identityLut(), 1)
    expect(mean(data, 1)).toBeGreaterThan(75)
  })

  it('pulls a bright white room down instead of washing it out', () => {
    const data = frame(40, 40, [230, 230, 228])
    developFilm(data, 40, 40, identityLut(), 1)
    expect(mean(data, 1)).toBeLessThan(215)
  })

  it('darkens the corners', () => {
    const w = 60
    const data = frame(w, w, [150, 150, 150])
    developFilm(data, w, w, null, 1)
    const patch = (x0: number, y0: number) => {
      let sum = 0
      for (let y = y0; y < y0 + 6; y++) for (let x = x0; x < x0 + 6; x++) sum += data[(y * w + x) * 4 + 1]
      return sum / 36
    }
    expect(patch(0, 0)).toBeLessThan(patch(27, 27) - 10)
  })

  it('puts a red halo around a bright light', () => {
    const w = 200 // the halo's reach scales with the width
    const data = frame(w, w, [20, 20, 20])
    for (let y = 90; y < 110; y++) for (let x = 90; x < 110; x++) data.set([255, 255, 255, 255], (y * w + x) * 4)
    developFilm(data, w, w, null, 1)
    let red = 0
    let blue = 0
    for (let y = 90; y < 110; y++)
      for (const x of [86, 87, 88, 111, 112, 113]) {
        red += data[(y * w + x) * 4]
        blue += data[(y * w + x) * 4 + 2]
      }
    expect(red).toBeGreaterThan(blue * 1.05) // the neutral glow is there too
  })

  it('applies the film LUT', () => {
    const tinted = new Uint8Array(LUT_BYTES)
    for (let i = 0; i < LUT_BYTES; i += 3) tinted.set([200, 60, 60], i) // everything prints red
    const data = frame(20, 20, [128, 128, 128])
    developFilm(data, 20, 20, tinted, 1)
    expect(mean(data, 0)).toBeGreaterThan(mean(data, 2) + 80)
  })

  it('never produces values out of range on extreme input', () => {
    const data = frame(16, 16, [255, 255, 255])
    developFilm(data, 16, 16, identityLut(), 3)
    for (const v of data) expect(v >= 0 && v <= 255 && !Number.isNaN(v)).toBe(true)
  })
})

describe('exposureFor', () => {
  const flat = (v: number) => new Float32Array(30).fill(v) // linear light

  it('gives dim and ordinary scenes the full film lift', () => {
    expect(exposureFor(flat(0.03))).toBe(RETRO.exposure)
    expect(exposureFor(flat(RETRO.brightKey))).toBeCloseTo(RETRO.exposure, 2)
  })

  it('pulls brighter scenes down further the brighter they are, up to a limit', () => {
    const bright = exposureFor(flat(0.2))
    const brighter = exposureFor(flat(0.4))
    expect(bright).toBeLessThan(RETRO.exposure)
    expect(brighter).toBeLessThan(bright)
    expect(exposureFor(flat(1))).toBe(RETRO.exposure - RETRO.brightPullMax)
  })

  it('judges on the gist, so one bright lamp does not darken a dim room', () => {
    const room = flat(0.03)
    room.fill(1, 0, 3) // one hot pixel in ten
    expect(exposureFor(room)).toBe(RETRO.exposure)
  })
})

describe('shoulder', () => {
  it('leaves everything below the knee alone', () => {
    expect(shoulder(0.3)).toBe(0.3)
    expect(shoulder(RETRO.shoulder)).toBe(RETRO.shoulder)
  })

  it('rolls highlights toward white without ever reaching or passing it', () => {
    expect(shoulder(0.9)).toBeLessThan(0.9)
    expect(shoulder(0.9)).toBeGreaterThan(shoulder(0.8))
    expect(shoulder(3)).toBeLessThan(1)
    expect(shoulder(3)).toBeGreaterThan(shoulder(1.5))
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
