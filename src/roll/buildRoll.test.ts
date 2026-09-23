import { describe, it, expect, vi } from 'vitest'
import { mergeRoll, buildRoll, idsNeedingViewUrls, attachViewUrls } from './buildRoll.ts'
import type { Shot } from '../capture/db.ts'
import type { ServerShot } from '../lib/api.ts'

function local(id: string, capturedAt: string, uploadStatus: Shot['uploadStatus'] = 'local', type: Shot['type'] = 'photo'): Shot {
  return { id, eventId: 'E', guestId: 'G', type, blob: new Blob([id]), capturedAt, uploadStatus }
}
function server(clientShotId: string, capturedAt: string, uploadStatus: ServerShot['uploadStatus'] = 'uploaded', type: ServerShot['type'] = 'photo'): ServerShot {
  return { clientShotId, capturedAt, uploadStatus, type }
}

describe('mergeRoll', () => {
  it('orders by capture time (mixed Z / +00:00 formats) and numbers frames', () => {
    const items = mergeRoll(
      [local('b', '2026-09-19T12:05:00.000Z'), local('a', '2026-09-19T12:01:00.000Z')],
      [server('c', '2026-09-19T12:03:00+00:00')],
    )
    expect(items.map((i) => [i.id, i.frame])).toEqual([
      ['a', 1],
      ['c', 2],
      ['b', 3],
    ])
  })

  it('marks saved when uploaded on either side, saving while only local', () => {
    const items = mergeRoll(
      [
        local('up-local', '2026-09-19T12:00:00Z', 'uploaded'),
        local('up-server', '2026-09-19T12:01:00Z', 'local'), // confirm landed, local flip didn't
        local('pending', '2026-09-19T12:02:00Z', 'local'),
      ],
      [server('up-server', '2026-09-19T12:01:00Z', 'uploaded'), server('pending', '2026-09-19T12:02:00Z', 'local')],
    )
    expect(Object.fromEntries(items.map((i) => [i.id, i.status]))).toEqual({
      'up-local': 'saved',
      'up-server': 'saved',
      pending: 'saving',
    })
    expect(items.every((i) => i.media.kind === 'device')).toBe(true)
  })

  it('device-only when the server is unreachable (null): statuses from local, no cloud tiles', () => {
    const items = mergeRoll(
      [local('a', '2026-09-19T12:00:00Z', 'uploaded'), local('b', '2026-09-19T12:01:00Z', 'local')],
      null,
    )
    expect(items.map((i) => [i.id, i.status])).toEqual([
      ['a', 'saved'],
      ['b', 'saving'],
    ])
  })

  it('cloud-only uploaded shot needs a view URL; cloud-only never-uploaded is unavailable', () => {
    const items = mergeRoll([], [
      server('gone-but-safe', '2026-09-19T12:00:00Z', 'uploaded', 'clip'),
      server('never-arrived', '2026-09-19T12:01:00Z', 'local'),
    ])
    expect(items.map((i) => [i.id, i.status, i.media.kind])).toEqual([
      ['gone-but-safe', 'saved', 'none'],
      ['never-arrived', 'unavailable', 'none'],
    ])
    expect(idsNeedingViewUrls(items)).toEqual(['gone-but-safe'])
  })

  it('a refused (over-limit) shot still shows its image, flagged not saved', () => {
    const [item] = mergeRoll([local('r', '2026-09-19T12:00:00Z', 'rejected')], [])
    expect(item.status).toBe('not_saved')
    expect(item.media.kind).toBe('device')
  })

  it('sorts unknown or garbled capture times last, deterministically', () => {
    const items = mergeRoll(
      [local('garbled', 'not-a-date'), local('ok', '2026-09-19T12:00:00Z')],
      [{ clientShotId: 'unknown', type: 'photo', uploadStatus: 'uploaded', capturedAt: null }],
    )
    expect(items.map((i) => i.id)).toEqual(['ok', 'garbled', 'unknown'])
    expect(items.map((i) => i.frame)).toEqual([1, 2, 3])
  })

  it('an empty roll is empty', () => {
    expect(mergeRoll([], [])).toEqual([])
    expect(mergeRoll([], null)).toEqual([])
  })
})

describe('attachViewUrls', () => {
  it('attaches signed URLs and marks unvouched cloud-only shots unavailable', () => {
    const items = mergeRoll([], [server('x', '2026-09-19T12:00:00Z'), server('y', '2026-09-19T12:01:00Z')])
    const out = attachViewUrls(items, { x: 'https://r2/x' })
    expect(out.find((i) => i.id === 'x')?.media).toEqual({ kind: 'cloud', url: 'https://r2/x' })
    expect(out.find((i) => i.id === 'y')?.status).toBe('unavailable')
  })
})

describe('buildRoll', () => {
  it('merges the server roll and fetches view URLs only for cloud-only saved shots', async () => {
    const issueViewUrls = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, `https://r2/${id}`])))
    const items = await buildRoll([local('here', '2026-09-19T12:00:00Z')], {
      getServerRoll: async () => [server('here', '2026-09-19T12:00:00Z'), server('evicted', '2026-09-19T12:01:00Z')],
      issueViewUrls,
    })
    expect(issueViewUrls).toHaveBeenCalledWith(['evicted'])
    expect(items.map((i) => [i.id, i.status, i.media.kind])).toEqual([
      ['here', 'saved', 'device'],
      ['evicted', 'saved', 'cloud'],
    ])
  })

  it('skips the view-URL call when nothing is cloud-only', async () => {
    const issueViewUrls = vi.fn(async () => ({}))
    await buildRoll([local('a', '2026-09-19T12:00:00Z')], {
      getServerRoll: async () => [server('a', '2026-09-19T12:00:00Z')],
      issueViewUrls,
    })
    expect(issueViewUrls).not.toHaveBeenCalled()
  })

  it('falls back to the device roll when the server read fails (never throws)', async () => {
    const items = await buildRoll([local('a', '2026-09-19T12:00:00Z')], {
      getServerRoll: async () => {
        throw new Error('offline')
      },
      issueViewUrls: async () => ({}),
    })
    expect(items.map((i) => [i.id, i.status])).toEqual([['a', 'saving']])
  })

  it('shows cloud-only shots as unavailable when view URLs cannot be fetched', async () => {
    const items = await buildRoll([], {
      getServerRoll: async () => [server('evicted', '2026-09-19T12:00:00Z')],
      issueViewUrls: async () => {
        throw new Error('timeout')
      },
    })
    expect(items.map((i) => [i.id, i.status])).toEqual([['evicted', 'unavailable']])
  })
})
