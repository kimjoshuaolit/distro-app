// Pure view-request rules — shared by issue-view-urls and unit-tested from the
// client project. No runtime-specific imports (safe in Deno and Node).
import { isUuid } from './join-rules.ts'

/** A whole roll (25 photos + 5 clips) fits in one request. */
export const MAX_VIEW_IDS = 30

/** Signed view URLs live 10 minutes (AD-2: short-lived bearer links only). */
export const VIEW_TTL_SECONDS = 600

export type ViewableRow = { client_shot_id: string; r2_key: string }

/**
 * Sign every viewable row (in parallel) into the response map keyed by the
 * client shot id — the key the app's roll uses. `sign` gets the storage key.
 */
export async function toViewUrlMap(
  rows: ViewableRow[],
  sign: (r2Key: string) => Promise<string>,
): Promise<Record<string, string>> {
  const signed = await Promise.all(
    rows.map(async (r) => [r.client_shot_id, await sign(r.r2_key)] as const),
  )
  return Object.fromEntries(signed)
}

/**
 * Attach an S3 presign lifetime to an object URL before signing it. aws4fetch
 * reads `X-Amz-Expires` from the URL; without it links would default to a day.
 */
export function withExpiry(objectUrl: string, ttlSeconds: number): string {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) throw new Error('Invalid TTL')
  return `${objectUrl}?X-Amz-Expires=${ttlSeconds}`
}

export type ViewRequest = { deviceToken: string; clientShotIds: string[] }

export type ViewRequestResult = { ok: true; value: ViewRequest } | { ok: false; error: 'bad_request' }

/** Validate an issue-view-urls body; duplicate ids are collapsed. */
export function validateViewRequest(raw: unknown): ViewRequestResult {
  const bad = { ok: false, error: 'bad_request' } as const
  if (!raw || typeof raw !== 'object') return bad
  const { deviceToken, clientShotIds } = raw as Record<string, unknown>
  if (typeof deviceToken !== 'string' || deviceToken.length === 0) return bad
  if (!Array.isArray(clientShotIds) || clientShotIds.length === 0) return bad
  if (clientShotIds.length > MAX_VIEW_IDS || !clientShotIds.every(isUuid)) return bad
  return { ok: true, value: { deviceToken, clientShotIds: [...new Set(clientShotIds)] } }
}
