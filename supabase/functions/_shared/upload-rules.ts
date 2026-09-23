// Pure upload rules — shared by the issue-upload-url function and unit-tested
// from the client project. No runtime-specific imports (safe in Deno and Node).

export type ShotType = 'photo' | 'clip'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Per-type size ceilings. Baked photos are ~1600px JPEGs (well under 1 MB);
 * a 10s MediaRecorder clip is a few MB. The caps bound storage cost (the budget
 * constraint) and are signed into the upload URL as content-length.
 */
export const MAX_BYTES: Record<ShotType, number> = {
  photo: 10 * 1024 * 1024,
  clip: 50 * 1024 * 1024,
}

/** Content types we accept, mapped to the R2 object-key extension. */
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

/**
 * Extension for a media content type, or null if unsupported. Strips any
 * `;codecs=...` parameter (MediaRecorder emits e.g. `video/webm;codecs=vp9`).
 */
export function extForContentType(contentType: unknown): string | null {
  if (typeof contentType !== 'string') return null
  const base = contentType.split(';')[0].trim().toLowerCase()
  return EXT_BY_TYPE[base] ?? null
}

export type UploadRequest = {
  deviceToken: string
  clientShotId: string
  type: ShotType
  contentType: string
  size: number
  capturedAt: string
  ext: string
}

export type UploadRequestResult =
  | { ok: true; value: UploadRequest }
  | { ok: false; error: 'bad_request' }

/** Validate and normalize an issue-upload-url request body. */
export function validateUploadRequest(raw: unknown): UploadRequestResult {
  const bad = { ok: false, error: 'bad_request' } as const
  if (!raw || typeof raw !== 'object') return bad
  const p = raw as Record<string, unknown>

  if (typeof p.deviceToken !== 'string' || p.deviceToken.length === 0) return bad
  if (typeof p.clientShotId !== 'string' || !UUID_RE.test(p.clientShotId)) return bad
  if (p.type !== 'photo' && p.type !== 'clip') return bad
  if (typeof p.contentType !== 'string') return bad
  const ext = extForContentType(p.contentType)
  if (!ext) return bad
  if (typeof p.capturedAt !== 'string' || Number.isNaN(Date.parse(p.capturedAt))) return bad
  if (!Number.isInteger(p.size) || (p.size as number) <= 0) return bad
  if ((p.size as number) > MAX_BYTES[p.type]) return bad
  // A photo must be a jpg; a clip must be a video. Guards against a mismatched
  // type/content pair producing a wrong extension on the durable object key.
  if (p.type === 'photo' && ext !== 'jpg') return bad
  if (p.type === 'clip' && ext === 'jpg') return bad

  return {
    ok: true,
    value: {
      deviceToken: p.deviceToken,
      clientShotId: p.clientShotId,
      type: p.type,
      contentType: p.contentType,
      size: p.size as number,
      capturedAt: p.capturedAt,
      ext,
    },
  }
}
