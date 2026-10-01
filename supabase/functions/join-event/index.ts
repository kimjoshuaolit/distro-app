// join-event — the only trusted path that creates a guest + allotment (AD-4, AD-5).
// Runs on Supabase Edge Functions (Deno). Uses the service role; validates the
// event window server-side; never trusts the client for identity or quota.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { isEventOpen, isUuid, validateFirstName } from '../_shared/join-rules.ts'
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

  let payload: { eventToken?: unknown; firstName?: unknown }
  try {
    payload = await req.json()
  } catch {
    return fail('bad_request', 'Invalid JSON body.', 400)
  }

  if (!isUuid(payload.eventToken)) {
    return fail('event_not_found', 'This camera link is not valid.', 404)
  }
  const name = validateFirstName(payload.firstName)
  if (!name.ok) {
    return fail('invalid_name', 'Please enter your first name.', 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: event, error: eventErr } = await supabase
    .from('events')
    .select('id, window_open, window_close')
    .eq('id', payload.eventToken)
    .maybeSingle()

  if (eventErr) return fail('server_error', 'Could not reach the event.', 500)
  if (!event) return fail('event_not_found', 'This camera link is not valid.', 404)

  if (!isEventOpen(event.window_open, event.window_close)) {
    return fail('event_closed', 'This camera isn’t open right now.', 403)
  }

  const deviceToken =
    crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')

  const { data: guest, error: insertErr } = await supabase
    .from('guests')
    .insert({
      event_id: event.id,
      first_name: name.value,
      device_token: deviceToken,
      photos_remaining: 25,
      clips_remaining: 5,
    })
    .select('id, first_name, photos_remaining, clips_remaining')
    .single()

  if (insertErr || !guest) {
    return fail('server_error', 'Could not create your roll. Please try again.', 500)
  }

  return json({
    guestId: guest.id,
    deviceToken,
    firstName: guest.first_name,
    photosRemaining: guest.photos_remaining,
    clipsRemaining: guest.clips_remaining,
  })
}))
