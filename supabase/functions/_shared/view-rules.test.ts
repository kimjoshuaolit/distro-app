import { describe, it, expect } from 'vitest'
import {
  validateViewRequest,
  MAX_VIEW_IDS,
  VIEW_TTL_SECONDS,
  toViewUrlMap,
  withExpiry,
} from './view-rules.ts'

describe('view URL lifetime (AD-2)', () => {
  it('signed view links live at most 10 minutes', () => {
    expect(VIEW_TTL_SECONDS).toBeGreaterThan(0)
    expect(VIEW_TTL_SECONDS).toBeLessThanOrEqual(600)
  })

  it('withExpiry sets X-Amz-Expires to exactly the requested TTL', () => {
    const url = new URL(withExpiry('https://acct.r2.cloudflarestorage.com/bucket/events/e/g/s.jpg', VIEW_TTL_SECONDS))
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(VIEW_TTL_SECONDS))
    expect(url.pathname).toBe('/bucket/events/e/g/s.jpg')
  })

  it('refuses a missing, zero or fractional TTL (would fall back to a long default)', () => {
    expect(() => withExpiry('https://x/y', 0)).toThrow()
    expect(() => withExpiry('https://x/y', 1.5)).toThrow()
    expect(() => withExpiry('https://x/y', Number.NaN)).toThrow()
  })
})

describe('toViewUrlMap', () => {
  it('keys signed URLs by client shot id (what the app looks up), signing the r2 key', async () => {
    const sign = async (key: string) => `signed:${key}`
    const map = await toViewUrlMap(
      [
        { client_shot_id: 'a', r2_key: 'events/e/g/a.jpg' },
        { client_shot_id: 'b', r2_key: 'events/e/g/b.mp4' },
      ],
      sign,
    )
    expect(map).toEqual({ a: 'signed:events/e/g/a.jpg', b: 'signed:events/e/g/b.mp4' })
  })

  it('returns an empty map when nothing is viewable', async () => {
    expect(await toViewUrlMap([], async () => 'x')).toEqual({})
  })

  it('fails as a whole if any signing fails (the function returns 500)', async () => {
    const sign = async (key: string) => {
      if (key === 'bad') throw new Error('sign failed')
      return key
    }
    await expect(
      toViewUrlMap(
        [
          { client_shot_id: 'a', r2_key: 'ok' },
          { client_shot_id: 'b', r2_key: 'bad' },
        ],
        sign,
      ),
    ).rejects.toThrow()
  })
})

const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

describe('validateViewRequest', () => {
  it('accepts a token and 1..30 uuids', () => {
    expect(validateViewRequest({ deviceToken: 'tok', clientShotIds: [id(1)] })).toEqual({
      ok: true,
      value: { deviceToken: 'tok', clientShotIds: [id(1)] },
    })
    const full = Array.from({ length: MAX_VIEW_IDS }, (_, i) => id(i))
    expect(validateViewRequest({ deviceToken: 'tok', clientShotIds: full }).ok).toBe(true)
  })

  it('collapses duplicate ids', () => {
    const res = validateViewRequest({ deviceToken: 'tok', clientShotIds: [id(1), id(1), id(2)] })
    expect(res.ok && res.value.clientShotIds).toEqual([id(1), id(2)])
  })

  it('rejects more than a roll of ids', () => {
    const tooMany = Array.from({ length: MAX_VIEW_IDS + 1 }, (_, i) => id(i))
    expect(validateViewRequest({ deviceToken: 'tok', clientShotIds: tooMany }).ok).toBe(false)
  })

  it('rejects empty, non-array, or non-uuid ids', () => {
    expect(validateViewRequest({ deviceToken: 'tok', clientShotIds: [] }).ok).toBe(false)
    expect(validateViewRequest({ deviceToken: 'tok', clientShotIds: id(1) }).ok).toBe(false)
    expect(validateViewRequest({ deviceToken: 'tok', clientShotIds: ['0ther000-0000-4000-8000-000000000001'] }).ok).toBe(false)
  })

  it('rejects a missing or empty device token and non-object bodies', () => {
    expect(validateViewRequest({ deviceToken: '', clientShotIds: [id(1)] }).ok).toBe(false)
    expect(validateViewRequest({ clientShotIds: [id(1)] }).ok).toBe(false)
    expect(validateViewRequest(null).ok).toBe(false)
    expect(validateViewRequest('x').ok).toBe(false)
  })
})
