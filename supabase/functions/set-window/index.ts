// set-window — the operator's Open now / Close now (Story 3.2, FR4). The
// window stays the single source of truth: this just moves its ends to the
// database's now() (operator_set_window, service_role only). Same gate as
// save-event: the database's is_operator() with the caller's own JWT. Joining
// follows the window at once (join-event); open cameras lock on their next
// status check; uploads of shots already taken continue for 7 days (0008).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { decideOperatorAccess } from '../_shared/operator-rules.ts'
import { mapSetWindowError, validateSetWindowRequest } from '../_shared/window-rules.ts'

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

/** A PostgREST/Postgres error, reduced to what's safe to log (no tokens). */
function describe(error: unknown): Record<string, unknown> {
  const e = (error ?? {}) as { code?: unknown; name?: unknown }
  return { name: e.name, code: e.code }
}

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) {
    console.error('set-window: missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY')
    return fail('server_error', 'Window control is not configured.', 500)
  }

  // The operator gate first, so a stranger learns nothing about the body.
  const authorization = req.headers.get('Authorization')
  let check = { data: null as unknown, error: null as unknown, status: 0 }
  if (authorization) {
    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: noSession,
    })
    const { data, error, status } = await asCaller.rpc('is_operator')
    check = { data, error, status }
  }
  const decision = decideOperatorAccess({ hasAuthHeader: !!authorization, ...check })
  if (decision === 'not_operator') return fail('not_operator', 'This console is for the operator.', 403)
  if (decision === 'server_error') {
    console.error('set-window: operator check failed', { status: check.status, ...describe(check.error) })
    return fail('server_error', 'Could not change the camera window.', 500)
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return fail('bad_request', 'Invalid JSON body.', 400)
  }
  const parsed = validateSetWindowRequest(payload)
  if (!parsed.ok) return fail('bad_request', 'Invalid window request.', 400)
  const { eventId, action } = parsed.value

  const service = createClient(url, serviceKey, { auth: noSession })
  const { data, error } = await service.rpc('operator_set_window', { p_event_id: eventId, p_action: action })
  if (error) {
    const failure = mapSetWindowError((error as { code?: unknown }).code)
    if (failure.status >= 500) console.error('set-window: update failed', { eventId, action, ...describe(error) })
    return fail(failure.code, failure.message, failure.status)
  }
  const row = Array.isArray(data) ? (data[0] as { window_open?: unknown; window_close?: unknown } | undefined) : undefined
  if (!row || typeof row.window_open !== 'string' || typeof row.window_close !== 'string') {
    console.error('set-window: unexpected result', { eventId, action })
    return fail('server_error', 'Could not change the camera window.', 500)
  }
  return json({ windowOpen: row.window_open, windowClose: row.window_close })
})
