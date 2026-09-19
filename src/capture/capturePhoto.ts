import { bakePhoto } from './retro.ts'
import { putShot, type Shot } from './db.ts'

/**
 * Capture one final photo: bake the current video frame and store it durably
 * BEFORE anything else (AD-1). Throws if the durable write fails, so the caller
 * never decrements the counter for a shot that wasn't saved.
 */
export async function capturePhoto(params: {
  video: HTMLVideoElement
  eventId: string
  guestId: string
  date?: Date
  seed?: number
}): Promise<Shot> {
  const capturedAt = new Date()
  const blob = await bakePhoto(params.video, {
    date: params.date ?? capturedAt,
    seed: params.seed,
  })
  const shot: Shot = {
    id: crypto.randomUUID(),
    eventId: params.eventId,
    guestId: params.guestId,
    type: 'photo',
    blob,
    capturedAt: capturedAt.toISOString(),
    uploadStatus: 'local',
  }
  await putShot(shot) // throws on failure → caller must not decrement
  return shot
}
