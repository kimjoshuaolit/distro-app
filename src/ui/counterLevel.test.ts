import { describe, it, expect } from 'vitest'
import { photoLevel } from './counterLevel.ts'

describe('photoLevel', () => {
  it('is done at zero (label changes, not color alone)', () => {
    expect(photoLevel(0)).toEqual({ level: 'done', label: 'done' })
  })

  it('flags the last shot', () => {
    expect(photoLevel(1)).toEqual({ level: 'last', label: 'last!' })
  })

  it('warns when near-empty', () => {
    expect(photoLevel(3)).toEqual({ level: 'low', label: 'photos' })
  })

  it('is ok with plenty left', () => {
    expect(photoLevel(12)).toEqual({ level: 'ok', label: 'photos' })
    expect(photoLevel(25)).toEqual({ level: 'ok', label: 'photos' })
  })
})
