import { describe, it, expect } from 'vitest'
import {
  validateViewRequest,
  validateCoupleViewRequest,
  MAX_VIEW_IDS,
  VIEW_TTL_SECONDS,
  toViewUrlMap,
  toCoupleViewUrlMap,
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

describe('toCoupleViewUrlMap', () => {
  it('keys signed URLs by shot id (shots.id), signing the r2 key', async () => {
    const map = await toCoupleViewUrlMap(
      [
        { shot_id: id(1), r2_key: 'events/e/g/1.jpg' },
        { shot_id: id(2), r2_key: 'events/e/g/2.mp4' },
      ],
      async (key) => `signed:${key}`,
    )
    expect(map).toEqual({ [id(1)]: 'signed:events/e/g/1.jpg', [id(2)]: 'signed:events/e/g/2.mp4' })
  })

  it('omits rows that fail to sign and reports them by shot id, never by key', async () => {
    const sign = async (key: string) => {
      if (key === 'bad') throw new Error('sign failed')
      return `signed:${key}`
    }
    const failures: Array<[string, unknown]> = []
    const map = await toCoupleViewUrlMap(
      [
        { shot_id: id(1), r2_key: 'ok' },
        { shot_id: id(2), r2_key: 'bad' },
        { shot_id: id(3), r2_key: 'also-ok' },
      ],
      sign,
      (shotId, err) => failures.push([shotId, err]),
    )
    expect(map).toEqual({ [id(1)]: 'signed:ok', [id(3)]: 'signed:also-ok' })
    expect(failures.map(([shotId]) => shotId)).toEqual([id(2)])
  })

  it('is empty (not a throw) when every row fails, or there are no rows', async () => {
    const fail = async () => {
      throw new Error('no creds')
    }
    await expect(toCoupleViewUrlMap([{ shot_id: id(1), r2_key: 'k' }], fail)).resolves.toEqual({})
    await expect(toCoupleViewUrlMap([], fail)).resolves.toEqual({})
  })
})

describe('validateCoupleViewRequest', () => {
  const EVENT = 'e0000000-0000-4000-8000-000000000001'

  it('accepts an event uuid and 1..30 shot uuids', () => {
    expect(validateCoupleViewRequest({ eventId: EVENT, shotIds: [id(1)] })).toEqual({
      ok: true,
      value: { eventId: EVENT, shotIds: [id(1)] },
    })
    const full = Array.from({ length: MAX_VIEW_IDS }, (_, i) => id(i))
    expect(validateCoupleViewRequest({ eventId: EVENT, shotIds: full }).ok).toBe(true)
  })

  it('lowercases ids so they match the keys Postgres returns', () => {
    const upper = 'ABCDEF00-0000-4000-8000-00000000000A'
    const res = validateCoupleViewRequest({ eventId: EVENT.toUpperCase(), shotIds: [upper] })
    expect(res).toEqual({ ok: true, value: { eventId: EVENT, shotIds: [upper.toLowerCase()] } })
  })

  it('rejects more than 30 ids, none, or a non-array', () => {
    const tooMany = Array.from({ length: MAX_VIEW_IDS + 1 }, (_, i) => id(i))
    expect(validateCoupleViewRequest({ eventId: EVENT, shotIds: tooMany }).ok).toBe(false)
    expect(validateCoupleViewRequest({ eventId: EVENT, shotIds: [] }).ok).toBe(false)
    expect(validateCoupleViewRequest({ eventId: EVENT, shotIds: id(1) }).ok).toBe(false)
    expect(validateCoupleViewRequest({ eventId: EVENT }).ok).toBe(false)
  })

  it('rejects non-uuid shot ids (client shot ids are not accepted either way)', () => {
    expect(validateCoupleViewRequest({ eventId: EVENT, shotIds: [id(1), 'rosa-1'] }).ok).toBe(false)
    expect(validateCoupleViewRequest({ eventId: EVENT, shotIds: [42] }).ok).toBe(false)
  })

  it('rejects repeated ids, in any case', () => {
    expect(validateCoupleViewRequest({ eventId: EVENT, shotIds: [id(1), id(1)] }).ok).toBe(false)
    const upper = 'ABCDEF00-0000-4000-8000-00000000000A'
    expect(validateCoupleViewRequest({ eventId: EVENT, shotIds: [upper, upper.toLowerCase()] }).ok).toBe(false)
  })

  it('rejects a missing or malformed event id and non-object bodies', () => {
    expect(validateCoupleViewRequest({ shotIds: [id(1)] }).ok).toBe(false)
    expect(validateCoupleViewRequest({ eventId: 'event-1', shotIds: [id(1)] }).ok).toBe(false)
    expect(validateCoupleViewRequest(null).ok).toBe(false)
    expect(validateCoupleViewRequest([EVENT]).ok).toBe(false)
    expect(validateCoupleViewRequest('x').ok).toBe(false)
  })
})
