import { describe, it, expect, vi, beforeEach } from 'vitest'

const putShot = vi.fn()
const bakePhoto = vi.fn()

vi.mock('./db.ts', () => ({ putShot: (...args: unknown[]) => putShot(...args) }))
vi.mock('./retro.ts', () => ({ bakePhoto: (...args: unknown[]) => bakePhoto(...args) }))

const { capturePhoto } = await import('./capturePhoto.ts')

const video = {} as HTMLVideoElement

beforeEach(() => {
  putShot.mockReset()
  bakePhoto.mockReset()
})

describe('capturePhoto', () => {
  it('stores a durable local photo shot and returns it', async () => {
    bakePhoto.mockResolvedValue(new Blob(['img'], { type: 'image/jpeg' }))
    putShot.mockResolvedValue(undefined)

    const shot = await capturePhoto({ video, eventId: 'E', guestId: 'G' })

    expect(putShot).toHaveBeenCalledTimes(1)
    const stored = putShot.mock.calls[0][0]
    expect(stored).toMatchObject({
      eventId: 'E',
      guestId: 'G',
      type: 'photo',
      uploadStatus: 'local',
    })
    expect(stored.blob).toBeInstanceOf(Blob)
    expect(typeof stored.id).toBe('string')
    expect(shot.id).toBe(stored.id)
  })

  it('propagates a durable-write failure so the caller never counts a lost shot', async () => {
    bakePhoto.mockResolvedValue(new Blob(['img']))
    putShot.mockRejectedValue(new Error('QuotaExceeded'))

    await expect(capturePhoto({ video, eventId: 'E', guestId: 'G' })).rejects.toThrow(
      'QuotaExceeded',
    )
  })

  it('does not store anything if the bake fails', async () => {
    bakePhoto.mockRejectedValue(new Error('Camera frame not ready'))

    await expect(capturePhoto({ video, eventId: 'E', guestId: 'G' })).rejects.toThrow()
    expect(putShot).not.toHaveBeenCalled()
  })
})
