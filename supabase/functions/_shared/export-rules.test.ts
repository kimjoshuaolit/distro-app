import { describe, it, expect } from 'vitest'
import { EXPORT_TTL_SECONDS, extOf, MAX_EXPORT_IDS, montageLink, validateExportRequest } from './export-rules'

const EVENT = '00000000-0000-4000-8000-000000000001'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('validateExportRequest', () => {
  it('accepts up to 100 unique shot ids, lowercased, and an optional montage flag', () => {
    const upper = 'ABCDEF00-0000-4000-8000-000000000001'
    expect(validateExportRequest({ eventId: EVENT.toUpperCase(), shotIds: [upper] })).toEqual({
      ok: true,
      value: { eventId: EVENT, shotIds: [upper.toLowerCase()], montage: false },
    })
    const full = Array.from({ length: MAX_EXPORT_IDS }, (_, i) => id(i + 1))
    expect(validateExportRequest({ eventId: EVENT, shotIds: full, montage: true })).toMatchObject({ ok: true })
  })

  it('may ask only for the montage', () => {
    expect(validateExportRequest({ eventId: EVENT, shotIds: [], montage: true })).toEqual({
      ok: true,
      value: { eventId: EVENT, shotIds: [], montage: true },
    })
  })

  it('refuses bad bodies', () => {
    for (const body of [
      null,
      [],
      'x',
      { eventId: 'nope', shotIds: [id(1)] },
      { eventId: EVENT },
      { eventId: EVENT, shotIds: 'x' },
      { eventId: EVENT, shotIds: [] }, // nothing asked for
      { eventId: EVENT, shotIds: [id(1), 'nope'] },
      { eventId: EVENT, shotIds: [id(1), id(1).toUpperCase()] }, // a repeat
      { eventId: EVENT, shotIds: Array.from({ length: MAX_EXPORT_IDS + 1 }, (_, i) => id(i + 1)) },
      { eventId: EVENT, shotIds: [id(1)], montage: 'yes' },
    ]) {
      expect(validateExportRequest(body), JSON.stringify(body)?.slice(0, 80)).toEqual({ ok: false, error: 'bad_request' })
    }
  })

  it('reads a key’s extension (never the key itself) for the saved file name', () => {
    expect(extOf('events/e/montage/1727.MP4')).toBe('mp4')
    expect(extOf('events/e/g/s.jpg')).toBe('jpg')
    expect(extOf('events/e/montage/noext')).toBeNull()
  })

  it('montageLink: nothing hosted is null; a hosted one is signed with its extension', async () => {
    const sign = async (k: string) => `https://signed/${k}`
    await expect(montageLink(null, sign)).resolves.toBeNull()
    await expect(montageLink('  ', sign)).resolves.toBeNull()
    await expect(montageLink(undefined, sign)).resolves.toBeNull()
    await expect(montageLink('events/e/montage/1727.MOV', sign)).resolves.toEqual({
      url: 'https://signed/events/e/montage/1727.MOV',
      ext: 'mov',
    })
  })

  it('montageLink: a signing failure throws — never "no montage"', async () => {
    await expect(montageLink('events/e/montage/1.mp4', () => Promise.reject(new Error('no R2 creds')))).rejects.toThrow(
      'no R2 creds',
    )
  })

  it('pins the link lifetime at 10 minutes', () => {
    expect(EXPORT_TTL_SECONDS).toBe(600)
  })
})
