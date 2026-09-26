// Pure rules for the operator montage upload (2.3, AD-7): argument parsing,
// extension → content type, object key naming, env checks. No I/O, so the
// script's decisions are unit-tested (vitest) without touching storage.
import { isUuid } from '../supabase/functions/_shared/join-rules.ts'

export const USAGE = 'Usage: npm run montage:upload -- <eventId> <file.mp4|.mov|.webm>'

/** The finished cut's container → the Content-Type it's stored (and served) with. */
export const MONTAGE_CONTENT_TYPES = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
} as const

export type MontageExt = keyof typeof MONTAGE_CONTENT_TYPES

/** A single S3/R2 PUT tops out just under 5 GiB; a montage is far smaller. */
export const MAX_MONTAGE_BYTES = 5 * 1024 ** 3 - 1

/** The signed PUT must start within this window (it's signed right before use). */
export const PUT_URL_TTL_SECONDS = 3600

/** The file's montage extension (case-insensitive), or null if it isn't one. */
export function montageExt(file: string): MontageExt | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(file.trim())
  const ext = match?.[1].toLowerCase()
  return ext && Object.hasOwn(MONTAGE_CONTENT_TYPES, ext) ? (ext as MontageExt) : null
}

export type UploadArgs = { eventId: string; file: string; ext: MontageExt; contentType: string }

export type ParseResult = { ok: true; value: UploadArgs } | { ok: false; message: string }

/** `<eventId> <file>` — exactly two arguments, a uuid event and a .mp4/.mov/.webm file. */
export function parseArgs(argv: string[]): ParseResult {
  if (argv.length !== 2) return { ok: false, message: 'Expected an event id and a file.' }
  const [eventId, file] = argv
  if (!isUuid(eventId)) return { ok: false, message: `"${eventId}" isn't an event id (a uuid).` }
  const ext = montageExt(file)
  if (!ext) return { ok: false, message: `"${file}" isn't a .mp4, .mov or .webm file.` }
  return {
    ok: true,
    value: { eventId: eventId.toLowerCase(), file, ext, contentType: MONTAGE_CONTENT_TYPES[ext] },
  }
}

/** A sortable UTC stamp for the key, e.g. 20260926T131548123Z. */
export function montageStamp(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error('Invalid date')
  return now.toISOString().replace(/[-:.]/g, '')
}

/**
 * `events/<eventId>/montage/<timestamp>.<ext>` — a new key per upload, so a
 * replaced montage is never served from a stale cache and the old object is
 * simply left behind (never overwritten).
 */
export function montageKey(eventId: string, ext: MontageExt, now: Date): string {
  if (!isUuid(eventId)) throw new Error('Invalid event id')
  return `events/${eventId.toLowerCase()}/montage/${montageStamp(now)}.${ext}`
}

export const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'R2_ENDPOINT',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const

export type MontageEnv = {
  supabaseUrl: string
  serviceRoleKey: string
  r2Endpoint: string
  r2Bucket: string
  r2AccessKeyId: string
  r2SecretAccessKey: string
  r2Region: string
}

export type EnvResult = { ok: true; value: MontageEnv } | { ok: false; missing: string[] }

/** The server credentials the script needs; names only are ever reported. */
export function readMontageEnv(env: Record<string, string | undefined>): EnvResult {
  const get = (name: string) => env[name]?.trim() ?? ''
  const missing = REQUIRED_ENV.filter((name) => get(name) === '')
  if (missing.length > 0) return { ok: false, missing }
  return {
    ok: true,
    value: {
      supabaseUrl: get('SUPABASE_URL'),
      serviceRoleKey: get('SUPABASE_SERVICE_ROLE_KEY'),
      r2Endpoint: get('R2_ENDPOINT'),
      r2Bucket: get('R2_BUCKET'),
      r2AccessKeyId: get('R2_ACCESS_KEY_ID'),
      r2SecretAccessKey: get('R2_SECRET_ACCESS_KEY'),
      r2Region: get('R2_REGION') || 'auto',
    },
  }
}

/** Path-style object URL (same shape the Edge Functions sign). */
export function objectUrl(endpoint: string, bucket: string, key: string): string {
  return `${endpoint.replace(/\/+$/, '')}/${bucket}/${key}`
}

/** 1536 → "1.5 KB"; for progress lines only. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}
