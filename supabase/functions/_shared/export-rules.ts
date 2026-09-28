// Pure Download all rules for issue-export-urls (Story 3.4), unit-tested from
// the client project. No runtime-specific imports (safe in Deno, Node and the
// browser).
import { isUuid } from './join-rules.ts'

/** Links per signing call (mirrors operator_export_keys' cap in 0010). */
export const MAX_EXPORT_IDS = 100

/** Export links live 10 minutes (AD-2: short-lived bearer links only). */
export const EXPORT_TTL_SECONDS = 600

/** A storage key's file extension, lowercased (e.g. "mp4"); null if it has none. */
export function extOf(key: string): string | null {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(key)
  return m ? m[1].toLowerCase() : null
}

/**
 * The montage entry for a Download all answer. No key (nothing hosted) → null,
 * which the client reads as "nothing to save". A key that fails to sign
 * THROWS — a signing outage must never look like "no montage".
 */
export async function montageLink(
  key: unknown,
  sign: (key: string) => Promise<string>,
): Promise<{ url: string; ext: string } | null> {
  if (typeof key !== 'string' || key.trim() === '') return null
  return { url: await sign(key), ext: extOf(key) ?? 'mp4' }
}

export type ExportRequest = { eventId: string; shotIds: string[]; montage: boolean }

export type ExportRequestResult = { ok: true; value: ExportRequest } | { ok: false; error: 'bad_request' }

/**
 * An issue-export-urls body: a uuid `eventId`, 0–100 unique uuid `shotIds`
 * (lowercased — the response map is keyed by what Postgres prints) and an
 * optional boolean `montage`. Asking for nothing at all is refused.
 */
export function validateExportRequest(raw: unknown): ExportRequestResult {
  const bad = { ok: false, error: 'bad_request' } as const
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad
  const { eventId, shotIds, montage } = raw as Record<string, unknown>
  if (!isUuid(eventId)) return bad
  if (montage !== undefined && typeof montage !== 'boolean') return bad
  if (!Array.isArray(shotIds) || shotIds.length > MAX_EXPORT_IDS || !shotIds.every(isUuid)) return bad
  const ids = shotIds.map((id) => id.toLowerCase())
  if (new Set(ids).size !== ids.length) return bad
  if (ids.length === 0 && montage !== true) return bad
  return { ok: true, value: { eventId: eventId.toLowerCase(), shotIds: ids, montage: montage === true } }
}
