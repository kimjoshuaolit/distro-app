import { describe, expect, it, vi } from 'vitest'
import {
  FLASH,
  averageLuma,
  isDark,
  nextFlashMode,
  planFlash,
  withFlash,
  type FlashEffects,
} from './flash.ts'

function effects() {
  const log: string[] = []
  const fx: FlashEffects = {
    torch: async (on) => void log.push(`torch ${on}`),
    screen: (on) => void log.push(`screen ${on}`),
    wait: async (ms) => void log.push(`wait ${ms}`),
  }
  return { fx, log }
}

describe('nextFlashMode', () => {
  it('cycles auto, on, off, and back', () => {
    expect(nextFlashMode('auto')).toBe('on')
    expect(nextFlashMode('on')).toBe('off')
    expect(nextFlashMode('off')).toBe('auto')
  })
})

describe('averageLuma / isDark', () => {
  it('reads black and white', () => {
    expect(averageLuma(new Uint8ClampedArray([0, 0, 0, 255]))).toBe(0)
    expect(averageLuma(new Uint8ClampedArray([255, 255, 255, 255]))).toBeCloseTo(255)
  })

  it('has nothing to read in an empty frame', () => {
    expect(averageLuma(new Uint8ClampedArray())).toBeNull()
  })

  it('treats an unreadable frame as not dark', () => {
    expect(isDark(null)).toBe(false)
    expect(isDark(FLASH.darkLuma - 1)).toBe(true)
    expect(isDark(FLASH.darkLuma)).toBe(false)
  })
})

describe('planFlash', () => {
  const base = { facing: 'environment', kind: 'photo', dark: false } as const

  it('never fires when off, even in the dark', () => {
    expect(planFlash({ ...base, mode: 'off', dark: true })).toBe('none')
  })

  it('always fires when on, even in daylight', () => {
    expect(planFlash({ ...base, mode: 'on' })).toBe('torch')
  })

  it('fires on auto only in the dark', () => {
    expect(planFlash({ ...base, mode: 'auto' })).toBe('none')
    expect(planFlash({ ...base, mode: 'auto', dark: true })).toBe('torch')
  })

  it('lights selfies with the screen', () => {
    expect(planFlash({ ...base, mode: 'on', facing: 'user' })).toBe('screen')
  })

  it('keeps the torch on for back-camera clips', () => {
    expect(planFlash({ ...base, mode: 'on', kind: 'clip' })).toBe('torch')
  })

  it('never whites out the screen for a selfie clip', () => {
    expect(planFlash({ ...base, mode: 'on', facing: 'user', kind: 'clip' })).toBe('none')
  })
})

describe('withFlash', () => {
  it('just shoots with no plan', async () => {
    const { fx, log } = effects()
    expect(await withFlash('none', fx, async () => 'shot')).toBe('shot')
    expect(log).toEqual([])
  })

  it('lights, settles, shoots, then turns off, in order', async () => {
    const { fx, log } = effects()
    await withFlash('torch', fx, async () => void log.push('shoot'))
    expect(log).toEqual(['torch true', `wait ${FLASH.torchSettleMs}`, 'shoot', 'torch false'])
  })

  it('uses the screen for a selfie', async () => {
    const { fx, log } = effects()
    await withFlash('screen', fx, async () => void log.push('shoot'))
    expect(log).toEqual(['screen true', `wait ${FLASH.screenSettleMs}`, 'shoot', 'screen false'])
  })

  it('turns the light off when the shot fails, and passes the failure on', async () => {
    const { fx, log } = effects()
    const failed = vi.fn(async () => {
      throw new Error('save failed')
    })
    await expect(withFlash('torch', fx, failed)).rejects.toThrow('save failed')
    expect(log.at(-1)).toBe('torch false')
  })
})
