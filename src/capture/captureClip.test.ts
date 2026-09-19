import { describe, it, expect, vi, beforeEach } from 'vitest'

// Track calls with a spy, but produce the resolve/reject outcome inline in the
// mock. Routing a rejection through vi.fn's mockRejectedValue makes tinyspy keep
// an internally-tracked rejected promise that vitest can flag as "unhandled"
// when it is the first awaited call — creating it here avoids that false alarm.
const putShot = vi.fn()
let failNext = false
vi.mock('./db.ts', () => ({
  putShot: (shot: unknown) => {
    putShot(shot)
    return failNext ? Promise.reject(new Error('QuotaExceeded')) : Promise.resolve()
  },
}))

const { saveClip } = await import('./captureClip.ts')

beforeEach(() => {
  putShot.mockReset()
  failNext = false
})

describe('saveClip', () => {
  it('stores a durable local clip shot and returns it', async () => {
    const shot = await saveClip(new Blob(['vid'], { type: 'video/webm' }), {
      eventId: 'E',
      guestId: 'G',
    })

    expect(putShot).toHaveBeenCalledTimes(1)
    const stored = putShot.mock.calls[0][0]
    expect(stored).toMatchObject({
      eventId: 'E',
      guestId: 'G',
      type: 'clip',
      uploadStatus: 'local',
    })
    expect(stored.blob).toBeInstanceOf(Blob)
    expect(shot.id).toBe(stored.id)
  })

  it('propagates a durable-write failure so a clip is never silently lost', async () => {
    failNext = true
    await expect(saveClip(new Blob(['vid']), { eventId: 'E', guestId: 'G' })).rejects.toThrow(
      'QuotaExceeded',
    )
  })
})
