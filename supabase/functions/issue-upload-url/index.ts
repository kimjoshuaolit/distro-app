// issue-upload-url — the trusted path that enforces the 25/5 cap (AD-4) and
// mints a short-lived signed R2 PUT URL (AD-2). Runs on Supabase Edge (Deno),
// uses the service role, and never lets R2 creds reach the client.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { reserveRefusal, validateUploadRequest } from '../_shared/upload-rules.ts'
import { presignPut, PUT_TTL_SECONDS } from '../_shared/r2.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function fail(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405)

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return fail('bad_request', 'Invalid JSON body.', 400)
  }

  const parsed = validateUploadRequest(payload)
  if (!parsed.ok) return fail('bad_request', 'Invalid upload request.', 400)
  const { deviceToken, clientShotId, type, contentType, size, capturedAt, ext } = parsed.value

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data, error } = await supabase.rpc('reserve_shot', {
    p_device_token: deviceToken,
    p_type: type,
    p_client_shot_id: clientShotId,
    p_captured_at: capturedAt,
    p_ext: ext,
  })

  if (error) return fail('server_error', 'Could not reserve the shot.', 500)
  const row = (Array.isArray(data) ? data[0] : data) as
    | { status: string; shot_id: string | null; r2_key: string | null }
    | undefined
  if (!row) return fail('server_error', 'Could not reserve the shot.', 500)

  // cap_reached / upload_closed (0008) are terminal for the client's queue.
  const refusal = reserveRefusal(row.status)
  if (refusal) return fail(refusal.code, refusal.message, refusal.status)
  if (!row.r2_key || !row.shot_id) {
    return fail('server_error', 'Could not reserve the shot.', 500)
  }

  let uploadUrl: string
  try {
    // Content-Type and Content-Length are signed: the PUT must match both.
    uploadUrl = await presignPut(row.r2_key, contentType, size)
  } catch {
    return fail('server_error', 'Could not sign the upload.', 500)
  }

  return json({ uploadUrl, r2Key: row.r2_key, shotId: row.shot_id, expiresIn: PUT_TTL_SECONDS })
})
