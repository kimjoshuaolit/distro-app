import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { asFilmLut } from './filmLut.ts'
import { LUT_BYTES } from './retro.ts'

describe('asFilmLut', () => {
  it('accepts the shipped film LUT', () => {
    const file = readFileSync(new URL('./film/fuji-fp-100c.bin', import.meta.url))
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    const lut = asFilmLut(buffer)
    expect(lut?.length).toBe(LUT_BYTES)
  })

  it('refuses anything that is not a whole LUT (an error page, a truncated download)', () => {
    expect(asFilmLut(new ArrayBuffer(0))).toBeNull()
    expect(asFilmLut(new ArrayBuffer(LUT_BYTES - 1))).toBeNull()
    expect(asFilmLut(new TextEncoder().encode('<!doctype html>').buffer)).toBeNull()
  })
})
