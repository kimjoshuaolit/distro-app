import { supabase } from './supabase'
import type { GuestSession } from './guestSession'
import type { Shot } from '../capture/db'

export type EventStatus =
  | { state: 'open' }
  | { state: 'pending'; opensAt: string | null } // window hasn't started yet
  | { state: 'ended' } // window has passed
  | { state: 'invalid' } // unknown or malformed id
  | { state: 'error' } // transient failure — retryable

type EventStatusRow = {
  is_open: boolean
  opens_at: string | null
  closes_at: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Advisory window status for an event id (UX only; join-event re-checks).
 * Malformed id -> 'invalid' (no wasted round-trip). RPC/transport failure ->
 * 'error' (retryable), NOT 'invalid'. Empty result -> 'invalid' (unknown id).
 * A not-open event is split into 'pending' (not started) vs 'ended' (passed).
 */
export async function getEventStatus(eventId: string): Promise<EventStatus> {
  if (!UUID_RE.test(eventId)) return { state: 'invalid' }
  const { data, error } = await supabase.rpc('event_status', { p_event_id: eventId })
  if (error) return { state: 'error' }
  const row = (Array.isArray(data) ? data[0] : data) as EventStatusRow | undefined
  if (!row) return { state: 'invalid' }
  if (row.is_open) return { state: 'open' }
  if (row.opens_at && Date.now() < new Date(row.opens_at).getTime()) {
    return { state: 'pending', opensAt: row.opens_at }
  }
  return { state: 'ended' }
}

export class JoinError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'JoinError'
    this.code = code
  }
}

export type JoinResult = Omit<GuestSession, 'eventId'>

/** Create this guest server-side and return their identity + allotment. */
export async function joinEvent(eventId: string, firstName: string): Promise<JoinResult> {
  const { data, error } = await supabase.functions.invoke('join-event', {
    body: { eventToken: eventId, firstName },
  })

  if (error) {
    let code = 'server_error'
    let message = 'Something went wrong. Please try again.'
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = (await ctx.json()) as { error?: { code?: string; message?: string } }
        if (body?.error?.code) {
          code = body.error.code
          message = body.error.message ?? message
        }
      } catch {
        // keep defaults
      }
    }
    throw new JoinError(code, message)
  }

  if (!data) throw new JoinError('server_error', 'Empty response from the server.')
  return {
    guestId: data.guestId,
    deviceToken: data.deviceToken,
    firstName: data.firstName,
    photosRemaining: data.photosRemaining,
    clipsRemaining: data.clipsRemaining,
  }
}

// Upload-path function calls time out so a stalled request on weak wifi can't
// wedge the background queue; a timeout surfaces as a transient 'server_error'.
const FUNCTION_TIMEOUT_MS = 20_000

export class UploadError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'UploadError'
    this.code = code
  }
}

/** Pull the typed `{ error: { code, message } }` out of a functions.invoke error. */
async function parseFunctionError(
  error: unknown,
  fallbackCode = 'server_error',
): Promise<{ code: string; message: string }> {
  let code = fallbackCode
  let message = 'Something went wrong. Please try again.'
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: { code?: string; message?: string } }
      if (body?.error?.code) {
        code = body.error.code
        message = body.error.message ?? message
      }
    } catch {
      // keep defaults
    }
  }
  return { code, message }
}

export type IssuedUpload = {
  uploadUrl: string
  r2Key: string
  shotId: string
  expiresIn: number
}

/**
 * Reserve a shot server-side (cap enforced, AD-4) and get a short-lived signed
 * R2 PUT URL. Throws `UploadError('cap_reached')` when the allotment is spent.
 */
export async function issueUploadUrl(deviceToken: string, shot: Shot): Promise<IssuedUpload> {
  const { data, error } = await supabase.functions.invoke('issue-upload-url', {
    body: {
      deviceToken,
      clientShotId: shot.id,
      type: shot.type,
      contentType: shot.blob.type,
      size: shot.blob.size,
      capturedAt: shot.capturedAt,
    },
    timeout: FUNCTION_TIMEOUT_MS,
  })
  if (error) {
    const { code, message } = await parseFunctionError(error)
    throw new UploadError(code, message)
  }
  if (!data?.uploadUrl) throw new UploadError('server_error', 'Empty response from the server.')
  return data as IssuedUpload
}

/** Time budget for a PUT: generous base plus ~2s per MB for slow venue wifi. */
export function putTimeoutMs(bytes: number): number {
  return 30_000 + Math.ceil(bytes / (1024 * 1024)) * 2_000
}

/**
 * PUT the blob straight to R2 via the signed URL (never through the function).
 * The URL signs Content-Type and Content-Length; the browser sets the length
 * from the Blob. A hung PUT aborts so the queue can't stall forever.
 */
export async function putToR2(uploadUrl: string, blob: Blob): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type },
    body: blob,
    signal: AbortSignal.timeout(putTimeoutMs(blob.size)),
  })
  if (!res.ok) {
    // 5xx/429/408 are transient; other 4xx (expired/mismatched signature) are not.
    const transient = res.status >= 500 || res.status === 429 || res.status === 408
    throw new UploadError(transient ? 'server_error' : 'put_failed', `Storage rejected the upload (${res.status}).`)
  }
}

/** A guest's shot as the server knows it (metadata only — no media). */
export type ServerShot = {
  clientShotId: string
  type: 'photo' | 'clip'
  uploadStatus: 'local' | 'uploaded'
  capturedAt: string | null
}

type ServerShotRow = {
  client_shot_id: string | null
  type: 'photo' | 'clip'
  upload_status: 'local' | 'uploaded'
  captured_at: string | null
}

/**
 * The guest's own roll from the server, read through RLS (FR12): the device
 * token rides in the `x-device-token` header on this request only, and the
 * `shots` policy returns just that guest's rows. Throws on any failure — the
 * caller falls back to the on-device roll.
 */
export async function getServerRoll(deviceToken: string): Promise<ServerShot[]> {
  const { data, error } = await supabase
    .from('shots')
    .select('client_shot_id, type, upload_status, captured_at')
    .order('captured_at', { ascending: true })
    .setHeader('x-device-token', deviceToken)
    .abortSignal(AbortSignal.timeout(FUNCTION_TIMEOUT_MS))
  if (error) throw new Error('Could not load your roll.')
  return ((data ?? []) as ServerShotRow[])
    .filter((r): r is ServerShotRow & { client_shot_id: string } => !!r.client_shot_id)
    .map((r) => ({
      clientShotId: r.client_shot_id,
      type: r.type,
      uploadStatus: r.upload_status,
      capturedAt: r.captured_at,
    }))
}

export type ViewUrls = { urls: Record<string, string>; expiresIn: number }

/**
 * Short-lived signed view URLs for the guest's own uploaded shots (AD-2).
 * Ids the server won't vouch for are simply absent from `urls`; `expiresIn`
 * (seconds) tells the caller when to ask again.
 */
export async function issueViewUrls(deviceToken: string, clientShotIds: string[]): Promise<ViewUrls> {
  const { data, error } = await supabase.functions.invoke('issue-view-urls', {
    body: { deviceToken, clientShotIds },
    timeout: FUNCTION_TIMEOUT_MS,
  })
  if (error) {
    const { message } = await parseFunctionError(error)
    throw new Error(message)
  }
  return {
    urls: (data?.urls ?? {}) as Record<string, string>,
    expiresIn: typeof data?.expiresIn === 'number' ? data.expiresIn : 0,
  }
}

/** Mark the shot uploaded server-side after a successful PUT. Idempotent. */
export async function confirmUpload(deviceToken: string, clientShotId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('confirm-upload', {
    body: { deviceToken, clientShotId },
    timeout: FUNCTION_TIMEOUT_MS,
  })
  if (error) {
    const { code, message } = await parseFunctionError(error)
    throw new UploadError(code, message)
  }
}
