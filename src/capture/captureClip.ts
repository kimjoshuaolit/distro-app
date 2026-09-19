import { putShot, type Shot } from './db.ts'

/**
 * Store a recorded clip durably (AD-1) before anything else. Throws if the
 * write fails, so the caller never decrements the counter for a lost clip.
 */
export async function saveClip(
  blob: Blob,
  params: { eventId: string; guestId: string },
): Promise<Shot> {
  const shot: Shot = {
    id: crypto.randomUUID(),
    eventId: params.eventId,
    guestId: params.guestId,
    type: 'clip',
    blob,
    capturedAt: new Date().toISOString(),
    uploadStatus: 'local',
  }
  await putShot(shot)
  return shot
}
