// Pure view-request rules — shared by issue-view-urls and unit-tested from the
// client project. No runtime-specific imports (safe in Deno and Node).
import { isUuid } from './join-rules.ts'

/** A whole roll (25 photos + 5 clips) fits in one request. */
export const MAX_VIEW_IDS = 30

/** Signed view URLs live 10 minutes (AD-2: short-lived bearer links only). */
export const VIEW_TTL_SECONDS = 600

export type ViewableRow = { client_shot_id: string; r2_key: string }

/** A row from couple_viewable_shot_keys: the couple addresses shots by server id. */
export type CoupleViewableRow = { shot_id: string; r2_key: string }

/** Sign `[id, r2Key]` pairs in parallel into an `{ id: url }` map; any failure fails the whole map. */
async function signAll(
  pairs: Array<readonly [string, string]>,
  sign: (r2Key: string) => Promise<string>,
): Promise<Record<string, string>> {
  const signed = await Promise.all(pairs.map(async ([id, key]) => [id, await sign(key)] as const))
  return Object.fromEntries(signed)
}

/**
 * Sign every viewable row (in parallel) into the response map keyed by the
 * client shot id — the key the app's roll uses. `sign` gets the storage key.
 */
export function toViewUrlMap(
  rows: ViewableRow[],
  sign: (r2Key: string) => Promise<string>,
): Promise<Record<string, string>> {
  return signAll(rows.map((r) => [r.client_shot_id, r.r2_key] as const), sign)
}

/**
 * The couple's variant of toViewUrlMap, keyed by shot id (`shots.id`). Tolerant:
 * rows are signed in parallel and a row that fails to sign is simply omitted
 * (reported to `onFailure` with its shot id, never its key), so one bad object
 * can't blank a whole batch. The client retries ids it didn't get.
 */
export async function toCoupleViewUrlMap(
  rows: CoupleViewableRow[],
  sign: (r2Key: string) => Promise<string>,
  onFailure?: (shotId: string, error: unknown) => void,
): Promise<Record<string, string>> {
  const settled = await Promise.allSettled(rows.map((r) => sign(r.r2_key)))
  const urls: Record<string, string> = {}
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') urls[rows[i].shot_id] = result.value
    else onFailure?.(rows[i].shot_id, result.reason)
  })
  return urls
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

export type CoupleViewRequest = { eventId: string; shotIds: string[] }

export type CoupleViewRequestResult =
  | { ok: true; value: CoupleViewRequest }
  | { ok: false; error: 'bad_request' }

/**
 * Validate an issue-couple-view-urls body: a uuid `eventId` and 1–30 unique
 * uuid `shotIds`. Ids are lowercased (Postgres prints uuids lowercase, and the
 * response map is keyed by what it returns); repeats are refused, not merged.
 */
export function validateCoupleViewRequest(raw: unknown): CoupleViewRequestResult {
  const bad = { ok: false, error: 'bad_request' } as const
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad
  const { eventId, shotIds } = raw as Record<string, unknown>
  if (!isUuid(eventId)) return bad
  if (!Array.isArray(shotIds) || shotIds.length === 0 || shotIds.length > MAX_VIEW_IDS) return bad
  if (!shotIds.every(isUuid)) return bad
  const ids = shotIds.map((id) => id.toLowerCase())
  if (new Set(ids).size !== ids.length) return bad
  return { ok: true, value: { eventId: eventId.toLowerCase(), shotIds: ids } }
}
