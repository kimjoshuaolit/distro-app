import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { putShot, getShotsByEvent, countByType, type Shot, type ShotType } from './db.ts'

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
