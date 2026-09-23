import { describe, it, expect, vi } from 'vitest'
import {
  createMediaCache,
  createViewUrlCache,
  loadRoll,
  viewerState,
  VIEW_REFRESH_MARGIN_MS,
  type ViewItem,
} from './rollSession.ts'
import type { RollItem } from './buildRoll.ts'
import type { Shot } from '../capture/db.ts'

const device = (id: string, frame = 1): RollItem => ({
  id,
  frame,
  type: 'photo',
  capturedAt: '2026-09-19T12:00:00Z',
  status: 'saved',
  media: { kind: 'device', blob: new Blob([id]) },
})
const cloud = (id: string, url: string): RollItem => ({ ...device(id), media: { kind: 'cloud', url } })
const none = (id: string, frame = 1): RollItem => ({ ...device(id, frame), status: 'unavailable', media: { kind: 'none' } })

function urlApi() {
  let n = 0
  return {
    create: vi.fn((): string => `blob:${++n}`),
    revoke: vi.fn((): void => undefined),
  }
}

describe('createMediaCache', () => {
  it('reuses one object URL per shot across refreshes (no clip restarts)', () => {
    const api = urlApi()
    const cache = createMediaCache(api)
    const first = cache.resolve([device('a'), device('b')])
    // A refresh reads fresh Blob objects from IndexedDB for the same shots.
    const second = cache.resolve([device('a'), device('b')])

    expect(api.create).toHaveBeenCalledTimes(2)
    expect(second.map((i) => i.src)).toEqual(first.map((i) => i.src))
    expect(api.revoke).not.toHaveBeenCalled()
  })

  it('revokes URLs only for shots that disappeared', () => {
    const api = urlApi()
    const cache = createMediaCache(api)
    const [a, b] = cache.resolve([device('a'), device('b')])
    cache.resolve([device('a')])
    expect(api.revoke).toHaveBeenCalledTimes(1)
    expect(api.revoke).toHaveBeenCalledWith(b.src)
    expect(api.revoke).not.toHaveBeenCalledWith(a.src)
  })

  it('passes cloud URLs through, gives nothing-to-show items a null src, and never makes object URLs for them', () => {
    const api = urlApi()
    const out = createMediaCache(api).resolve([cloud('c', 'https://r2/c'), none('n')])
    expect(out.map((i) => i.src)).toEqual(['https://r2/c', null])
    expect(api.create).not.toHaveBeenCalled()
  })

  it('dispose revokes every object URL it created', () => {
    const api = urlApi()
    const cache = createMediaCache(api)
    cache.resolve([device('a'), device('b')])
    cache.dispose()
    expect(api.revoke).toHaveBeenCalledTimes(2)
  })
})

describe('createViewUrlCache', () => {
  function setup(response: { urls: Record<string, string>; expiresIn: number } = { urls: {}, expiresIn: 600 }) {
    let now = 1_000_000
    const fetchUrls = vi.fn(async (ids: string[]) => ({
      urls: Object.fromEntries(ids.filter((id) => id in response.urls || response.urls['*']).map((id) => [id, `${response.urls[id] ?? response.urls['*']}#${now}`])),
      expiresIn: response.expiresIn,
    }))
    const cache = createViewUrlCache(fetchUrls, () => now)
    return { cache, fetchUrls, advance: (ms: number) => (now += ms) }
  }

  it('serves still-fresh URLs from cache without asking the server again', async () => {
    const { cache, fetchUrls } = setup({ urls: { '*': 'https://r2/x' }, expiresIn: 600 })
    const first = await cache.get(['a'])
    const second = await cache.get(['a'])
    expect(fetchUrls).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('re-asks once a URL is within the refresh margin of expiring', async () => {
    const { cache, fetchUrls, advance } = setup({ urls: { '*': 'https://r2/x' }, expiresIn: 600 })
    const first = await cache.get(['a'])
    advance(600_000 - VIEW_REFRESH_MARGIN_MS + 1)
    const second = await cache.get(['a'])
    expect(fetchUrls).toHaveBeenCalledTimes(2)
    expect(second.a).not.toBe(first.a)
  })

  it('fetches only the ids it does not already hold fresh', async () => {
    const { cache, fetchUrls } = setup({ urls: { '*': 'https://r2/x' }, expiresIn: 600 })
    await cache.get(['a'])
    await cache.get(['a', 'b'])
    expect(fetchUrls).toHaveBeenLastCalledWith(['b'])
  })

  it('never throws: a failed fetch keeps fresh cached URLs and leaves the rest out', async () => {
    let fail = false
    let now = 0
    const cache = createViewUrlCache(async (ids) => {
      if (fail) throw new Error('offline')
      return { urls: Object.fromEntries(ids.map((id) => [id, `u-${id}`])), expiresIn: 600 }
    }, () => now)
    await cache.get(['a'])
    fail = true
    now += 1_000
    await expect(cache.get(['a', 'b'])).resolves.toEqual({ a: 'u-a' })
  })

  it('invalidate forces a re-fetch for that shot (e.g. its image failed to load)', async () => {
    const { cache, fetchUrls } = setup({ urls: { '*': 'https://r2/x' }, expiresIn: 600 })
    await cache.get(['a'])
    cache.invalidate('a')
    await cache.get(['a'])
    expect(fetchUrls).toHaveBeenCalledTimes(2)
  })

  it('reports the earliest expiry, and does not cache links with no lifetime', async () => {
    const withTtl = setup({ urls: { '*': 'https://r2/x' }, expiresIn: 600 })
    expect(withTtl.cache.nextExpiry()).toBeNull()
    await withTtl.cache.get(['a'])
    expect(withTtl.cache.nextExpiry()).toBe(1_000_000 + 600_000)

    const noTtl = setup({ urls: { '*': 'https://r2/x' }, expiresIn: 0 })
    expect(await noTtl.cache.get(['a'])).toHaveProperty('a')
    expect(noTtl.cache.nextExpiry()).toBeNull() // no refresh timer to spin on
  })
})

describe('loadRoll', () => {
  const shot = (id: string): Shot => ({
    id,
    eventId: 'E',
    guestId: 'G',
    type: 'photo',
    blob: new Blob([id]),
    capturedAt: '2026-09-19T12:00:00Z',
    uploadStatus: 'local',
  })

  it('paints the device roll before the server answers (AD-1), then commits the full roll', async () => {
    let release!: (items: RollItem[]) => void
    const commits: string[][] = []
    const done = loadRoll(
      {
        readLocal: async () => [shot('a')],
        build: () => new Promise<RollItem[]>((r) => (release = r)),
      },
      { paintDeviceFirst: true },
      (items) => commits.push(items.map((i) => i.id)),
    )
    await vi.waitFor(() => expect(commits).toEqual([['a']])) // device paint, server still pending
    release([device('a'), device('cloud-only', 2)])
    await done
    expect(commits).toEqual([['a'], ['a', 'cloud-only']])
  })

  it('skips the device-only paint on refreshes so cloud tiles do not flicker', async () => {
    const commit = vi.fn()
    await loadRoll(
      { readLocal: async () => [shot('a')], build: async () => [device('a'), cloud('c', 'u')] },
      { paintDeviceFirst: false },
      commit,
    )
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0][0].map((i: RollItem) => i.id)).toEqual(['a', 'c'])
  })

  it('without a guest token it shows the device roll only', async () => {
    const commit = vi.fn()
    await loadRoll({ readLocal: async () => [shot('a')] }, { paintDeviceFirst: false }, commit)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('treats an unreadable local store as an empty device roll (never throws)', async () => {
    const commit = vi.fn()
    await loadRoll(
      {
        readLocal: async () => {
          throw new Error('IndexedDB blocked')
        },
      },
      { paintDeviceFirst: true },
      commit,
    )
    expect(commit).toHaveBeenCalledWith([])
  })
})

describe('viewerState', () => {
  const items: ViewItem[] = [
    { ...device('a', 1), src: 'blob:1' },
    { ...none('gone', 2), src: null },
    { ...device('c', 3), src: 'blob:3' },
  ]

  it('opens the tapped shot even when unavailable tiles come before it', () => {
    const { viewable, index } = viewerState(items, 'c')
    expect(viewable.map((i) => i.id)).toEqual(['a', 'c'])
    expect(viewable[index].id).toBe('c')
    expect(viewable[index].frame).toBe(3) // frame number stays the roll's, not the viewer's
  })

  it('is closed (-1) when nothing is open or the open shot has nothing to show', () => {
    expect(viewerState(items, null).index).toBe(-1)
    expect(viewerState(items, 'gone').index).toBe(-1)
    expect(viewerState(items, 'missing').index).toBe(-1)
  })
})
