import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  putShot,
  getShotsByEvent,
  countByType,
  getPendingUploads,
  markUploaded,
  markRejected,
  countRejected,
  type Shot,
  type ShotType,
} from './db.ts'

function shot(id: string, eventId: string, type: ShotType): Shot {
  return {
    id,
    eventId,
    guestId: 'g1',
    type,
    blob: new Blob([id], { type: 'image/jpeg' }),
    capturedAt: new Date().toISOString(),
    uploadStatus: 'local',
  }
}

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('drc')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
})

describe('shots IndexedDB', () => {
  it('stores shots and reads them back scoped to their event', async () => {
    await putShot(shot('a', 'E1', 'photo'))
    await putShot(shot('b', 'E1', 'photo'))
    await putShot(shot('c', 'E1', 'clip'))
    await putShot(shot('d', 'E2', 'photo'))

    const e1 = await getShotsByEvent('E1')
    expect(e1.map((s) => s.id).sort()).toEqual(['a', 'b', 'c'])
    expect(await getShotsByEvent('E2')).toHaveLength(1)
  })

  it('counts shots by type for an event', async () => {
    await putShot(shot('a', 'E1', 'photo'))
    await putShot(shot('b', 'E1', 'photo'))
    await putShot(shot('c', 'E1', 'clip'))

    expect(await countByType('E1', 'photo')).toBe(2)
    expect(await countByType('E1', 'clip')).toBe(1)
    expect(await countByType('E2', 'photo')).toBe(0)
  })

  it('preserves the stored blob', async () => {
    await putShot(shot('a', 'E1', 'photo'))
    const [stored] = await getShotsByEvent('E1')
    expect(stored.blob).toBeInstanceOf(Blob)
    expect(await stored.blob.text()).toBe('a')
  })
})

describe('upload queue helpers', () => {
  const at = (s: Shot, iso: string, status: Shot['uploadStatus'] = 'local'): Shot => ({
    ...s,
    capturedAt: iso,
    uploadStatus: status,
  })

  it('returns only local shots for the event, oldest first', async () => {
    await putShot(at(shot('late', 'E1', 'photo'), '2026-09-19T12:05:00.000Z'))
    await putShot(at(shot('early', 'E1', 'clip'), '2026-09-19T12:01:00.000Z'))
    await putShot(at(shot('done', 'E1', 'photo'), '2026-09-19T12:00:00.000Z', 'uploaded'))
    await putShot(at(shot('refused', 'E1', 'photo'), '2026-09-19T12:00:30.000Z', 'rejected'))
    await putShot(at(shot('other', 'E2', 'photo'), '2026-09-19T12:00:00.000Z'))

    const pending = await getPendingUploads('E1')
    expect(pending.map((s) => s.id)).toEqual(['early', 'late'])
  })

  it('markUploaded persists and removes the shot from the pending set', async () => {
    await putShot(shot('a', 'E1', 'photo'))
    await putShot(shot('b', 'E1', 'photo'))

    await markUploaded('a')

    expect((await getPendingUploads('E1')).map((s) => s.id)).toEqual(['b'])
    const stored = (await getShotsByEvent('E1')).find((s) => s.id === 'a')
    expect(stored?.uploadStatus).toBe('uploaded')
    expect(await stored?.blob.text()).toBe('a') // blob kept for the own-roll view
  })

  it('markRejected persists, leaves pending, and is counted', async () => {
    await putShot(shot('a', 'E1', 'photo'))

    await markRejected('a')

    expect(await getPendingUploads('E1')).toHaveLength(0)
    expect(await countRejected('E1')).toBe(1)
    expect(await countRejected('E2')).toBe(0)
  })

  it('markRejected records why: over the cap by default, or uploads closed', async () => {
    await putShot(shot('cap-1', 'E3', 'photo'))
    await putShot(shot('late-1', 'E3', 'photo'))
    await markRejected('cap-1')
    await markRejected('late-1', 'closed')
    const byId = Object.fromEntries((await getShotsByEvent('E3')).map((s) => [s.id, s.rejectReason]))
    expect(byId).toEqual({ 'cap-1': 'cap', 'late-1': 'closed' })
    expect(await countRejected('E3')).toBe(2)
  })

  it('marking an unknown id is a harmless no-op', async () => {
    await expect(markUploaded('missing')).resolves.toBeUndefined()
  })
})
