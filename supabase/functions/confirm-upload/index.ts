// confirm-upload — marks a shot 'uploaded' once its object is verifiably in
// storage. Idempotent; scoped to the guest that owns the device token. Never
// trusts the client's word that the PUT landed: HEAD-checks the object first.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { isUuid } from '../_shared/join-rules.ts'
import { objectExists } from '../_shared/r2.ts'
import { withCors } from '../_shared/cors.ts'

const cors = {
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

Deno.serve(withCors(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405)

  let payload: { deviceToken?: unknown; clientShotId?: unknown }
  try {
    payload = await req.json()
  } catch {
    return fail('bad_request', 'Invalid JSON body.', 400)
  }
  const { deviceToken, clientShotId } = payload
  if (typeof deviceToken !== 'string' || deviceToken.length === 0 || !isUuid(clientShotId)) {
    return fail('bad_request', 'Missing device token or shot id.', 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: guest, error: guestErr } = await supabase
    .from('guests')
    .select('id')
    .eq('device_token', deviceToken)
    .maybeSingle()
  if (guestErr) return fail('server_error', 'Could not reach the roll.', 500)
  if (!guest) return fail('guest_not_found', 'Unknown guest.', 404)

  const { data: shot, error: shotErr } = await supabase
    .from('shots')
    .select('r2_key')
    .eq('guest_id', guest.id)
    .eq('client_shot_id', clientShotId)
    .maybeSingle()
  if (shotErr) return fail('server_error', 'Could not reach the roll.', 500)
  if (!shot?.r2_key) return fail('shot_not_found', 'Unknown shot.', 404)

  let present: boolean
  try {
    present = await objectExists(shot.r2_key)
  } catch {
    return fail('server_error', 'Could not check storage.', 500)
  }
  if (!present) return fail('not_uploaded', 'The upload hasn’t arrived yet.', 409)

  const { data: status, error: confirmErr } = await supabase.rpc('confirm_shot', {
    p_device_token: deviceToken,
    p_client_shot_id: clientShotId,
  })
  if (confirmErr) return fail('server_error', 'Could not confirm the upload.', 500)
  if (status !== 'confirmed') return fail('shot_not_found', 'Unknown shot.', 404)

  return json({ ok: true })
}))
