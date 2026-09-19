import { describe, it, expect } from 'vitest'
import { pickClipMimeType } from './mediaSupport.ts'

describe('pickClipMimeType', () => {
  it('prefers mp4 when supported', () => {
    expect(pickClipMimeType(() => true)).toBe('video/mp4')
  })

  it('falls back to the first supported webm variant', () => {
    expect(pickClipMimeType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus')
  })

  it('returns plain webm when only that is supported', () => {
    expect(pickClipMimeType((t) => t === 'video/webm')).toBe('video/webm')
  })

  it('returns null when nothing is supported', () => {
    expect(pickClipMimeType(() => false)).toBeNull()
  })
})
