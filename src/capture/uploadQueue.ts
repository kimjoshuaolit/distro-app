import type { Shot } from './db'

/**
 * - 'uploaded'    terminal: stored, confirmed, flipped locally
 * - 'cap_reached' terminal: server refused (no allotment); marked rejected
 * - 'skipped'     this shot failed for a shot-specific reason (bad request,
 *                 expired signature, object not yet visible); it stays local
 *                 and is retried on a later pass, but doesn't block the others
 * - 'retry'       transient (offline, timeout, 5xx); stop the batch and back off
 */
export type UploadOutcome = 'uploaded' | 'cap_reached' | 'skipped' | 'retry'

// Injected so the orchestration is unit-testable without network or IndexedDB.
export type UploadDeps = {
  issueUploadUrl: (deviceToken: string, shot: Shot) => Promise<{ uploadUrl: string }>
  putToR2: (uploadUrl: string, blob: Blob) => Promise<void>
  confirmUpload: (deviceToken: string, clientShotId: string) => Promise<void>
  markUploaded: (id: string) => Promise<void>
  markRejected: (id: string) => Promise<void>
}

/** Exponential backoff with a ceiling. Deterministic (no jitter) for tests. */
export function nextDelay(attempt: number, base = 1000, max = 30_000): number {
  return Math.min(max, base * 2 ** Math.max(0, attempt))
}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string') {
    return (err as { code: string }).code
  }
  return undefined
}

/** Network/timeout errors carry no code; the server's 5xx maps to 'server_error'. */
function isTransient(code: string | undefined): boolean {
  return code === undefined || code === 'server_error'
}

/**
 * Upload one shot end-to-end: reserve (cap-checked) -> PUT to R2 -> confirm ->
 * flip local status. Terminal outcomes persist ('uploaded' / 'rejected'); any
 * other failure leaves the shot 'local' so it is never lost (AD-1).
 */
export async function uploadShot(
  shot: Shot,
  deviceToken: string,
  deps: UploadDeps,
): Promise<UploadOutcome> {
  try {
    const { uploadUrl } = await deps.issueUploadUrl(deviceToken, shot)
    await deps.putToR2(uploadUrl, shot.blob)
    await deps.confirmUpload(deviceToken, shot.id)
    await deps.markUploaded(shot.id)
    return 'uploaded'
  } catch (err) {
    const code = errorCode(err)
    if (code === 'cap_reached') {
      try {
        await deps.markRejected(shot.id)
        return 'cap_reached'
      } catch {
        return 'retry' // couldn't persist the rejection; try again later
      }
    }
    return isTransient(code) ? 'retry' : 'skipped'
  }
}

/**
 * Drain a batch of pending shots in order. A transient failure stops the batch
 * (usually offline — the rest would fail too); a shot-specific failure is
 * skipped so one bad shot can't block the roll. `allSettled` is true only when
 * every shot reached a terminal state, i.e. nothing is left to retry.
 */
export async function drainOnce(
  shots: Shot[],
  deviceToken: string,
  deps: UploadDeps,
): Promise<{ allSettled: boolean }> {
  let allSettled = true
  for (const shot of shots) {
    const outcome = await uploadShot(shot, deviceToken, deps)
    if (outcome === 'retry') return { allSettled: false }
    if (outcome === 'skipped') allSettled = false
  }
  return { allSettled }
}
