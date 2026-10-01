// issue-view-urls — short-lived signed GET URLs so a guest can view their own
// uploaded shots that are no longer on their phone (AD-2). Ownership is decided
// in SQL (`viewable_shot_keys`); ids that aren't the caller's uploaded shots are
// simply omitted.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { toViewUrlMap, validateViewRequest, VIEW_TTL_SECONDS, type ViewableRow } from '../_shared/view-rules.ts'
import { presignGet } from '../_shared/r2.ts'
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

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return fail('bad_request', 'Invalid JSON body.', 400)
  }
  const parsed = validateViewRequest(payload)
  if (!parsed.ok) return fail('bad_request', 'Invalid view request.', 400)
  const { deviceToken, clientShotIds } = parsed.value

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

  const { data: keys, error: keysErr } = await supabase.rpc('viewable_shot_keys', {
    p_device_token: deviceToken,
    p_client_shot_ids: clientShotIds,
  })
  if (keysErr) return fail('server_error', 'Could not reach the roll.', 500)

  let urls: Record<string, string>
  try {
    urls = await toViewUrlMap((keys ?? []) as ViewableRow[], (r2Key) => presignGet(r2Key, VIEW_TTL_SECONDS))
  } catch {
    return fail('server_error', 'Could not sign view links.', 500)
  }

  return json({ urls, expiresIn: VIEW_TTL_SECONDS })
}))
