import { describe, it, expect } from 'vitest'
import {
  formatBytes,
  montageExt,
  montageKey,
  montageStamp,
  objectUrl,
  parseArgs,
  readMontageEnv,
  REQUIRED_ENV,
} from './montage-rules.ts'

const EVENT = '00000000-0000-0000-0000-000000000001'
const NOW = new Date('2026-09-26T13:15:48.123Z')

describe('montageExt / content type', () => {
  it('knows mp4, mov and webm, case-insensitively', () => {
    expect(montageExt('cut.mp4')).toBe('mp4')
    expect(montageExt('C:\\Videos\\Final Cut.MOV')).toBe('mov')
    expect(montageExt('./out/reveal.v2.webm')).toBe('webm')
  })

  it('refuses anything else', () => {
    for (const f of ['cut.mkv', 'cut', 'cut.mp4.txt', 'mp4', '.', 'cut.', 'cut.constructor', 'cut.toString']) {
      expect(montageExt(f), f).toBeNull()
    }
  })
})

describe('parseArgs', () => {
  it('takes <eventId> <file> and derives the content type', () => {
    expect(parseArgs([EVENT, 'cut.mp4'])).toEqual({
      ok: true,
      value: { eventId: EVENT, file: 'cut.mp4', ext: 'mp4', contentType: 'video/mp4' },
    })
    expect(parseArgs([EVENT, 'cut.mov'])).toMatchObject({ ok: true, value: { contentType: 'video/quicktime' } })
    expect(parseArgs([EVENT, 'cut.webm'])).toMatchObject({ ok: true, value: { contentType: 'video/webm' } })
  })

  it('lowercases the event id', () => {
    expect(parseArgs(['D0D0D0D0-0000-4000-8000-0000000000E1', 'a.mp4'])).toMatchObject({
      ok: true,
      value: { eventId: 'd0d0d0d0-0000-4000-8000-0000000000e1' },
    })
  })

  it('explains a missing/extra argument, a bad id, or a bad extension', () => {
    expect(parseArgs([])).toMatchObject({ ok: false })
    expect(parseArgs([EVENT])).toMatchObject({ ok: false })
    expect(parseArgs([EVENT, 'a.mp4', 'extra'])).toMatchObject({ ok: false })
    expect(parseArgs(['nope', 'a.mp4'])).toMatchObject({ ok: false, message: expect.stringContaining('nope') })
    expect(parseArgs([EVENT, 'a.avi'])).toMatchObject({ ok: false, message: expect.stringContaining('a.avi') })
  })
})

describe('montageKey', () => {
  it('is events/<eventId>/montage/<timestamp>.<ext>', () => {
    expect(montageStamp(NOW)).toBe('20260926T131548123Z')
    expect(montageKey(EVENT, 'mp4', NOW)).toBe(`events/${EVENT}/montage/20260926T131548123Z.mp4`)
  })

  it('a later upload gets a new key (replace = new key wins, old object kept)', () => {
    const later = new Date(NOW.getTime() + 1)
    expect(montageKey(EVENT, 'mp4', later)).not.toBe(montageKey(EVENT, 'mp4', NOW))
  })

  it('keys sort by time', () => {
    const a = montageKey(EVENT, 'mp4', new Date('2026-09-26T09:59:59.999Z'))
    const b = montageKey(EVENT, 'mp4', new Date('2026-09-26T10:00:00.000Z'))
    expect([b, a].sort()).toEqual([a, b])
  })

  it('refuses a bad event id or date', () => {
    expect(() => montageKey('../../x', 'mp4', NOW)).toThrow()
    expect(() => montageKey(EVENT, 'mp4', new Date('nope'))).toThrow()
  })
})

describe('readMontageEnv', () => {
  const full = {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    R2_ENDPOINT: 'http://127.0.0.1:54321/storage/v1/s3',
    R2_BUCKET: 'shots',
    R2_ACCESS_KEY_ID: 'id',
    R2_SECRET_ACCESS_KEY: 'secret',
  }

  it('reads every server credential; the region defaults to auto', () => {
    expect(readMontageEnv(full)).toEqual({
      ok: true,
      value: {
        supabaseUrl: 'http://127.0.0.1:54321',
        serviceRoleKey: 'service',
        r2Endpoint: 'http://127.0.0.1:54321/storage/v1/s3',
        r2Bucket: 'shots',
        r2AccessKeyId: 'id',
        r2SecretAccessKey: 'secret',
        r2Region: 'auto',
      },
    })
    expect(readMontageEnv({ ...full, R2_REGION: 'local' })).toMatchObject({ value: { r2Region: 'local' } })
  })

  it('names (only names) whatever is missing or blank', () => {
    expect(readMontageEnv({})).toEqual({ ok: false, missing: [...REQUIRED_ENV] })
    const r = readMontageEnv({ ...full, R2_BUCKET: '  ', SUPABASE_SERVICE_ROLE_KEY: undefined })
    expect(r).toEqual({ ok: false, missing: ['SUPABASE_SERVICE_ROLE_KEY', 'R2_BUCKET'] })
  })
})

describe('objectUrl / formatBytes', () => {
  it('builds a path-style URL, tolerating a trailing slash', () => {
    expect(objectUrl('http://h/s3/', 'b', 'events/e/montage/k.mp4')).toBe('http://h/s3/b/events/e/montage/k.mp4')
    expect(objectUrl('https://acct.r2.cloudflarestorage.com', 'b', 'k')).toBe('https://acct.r2.cloudflarestorage.com/b/k')
  })

  it('formats sizes for humans', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(734 * 1024 * 1024)).toBe('734.0 MB')
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2.5 GB')
  })
})
