// save-event — the operator creates or edits one event: couple names, the
// capture window and the 0–2 couple emails (Story 3.1, FR4 setup, AD-3/AD-5).
// The only write path for events and their couple list (0006 revoked client
// writes). The gate asks the database's is_operator() with the caller's own
// JWT — the inbox-proof rule lives there — then the service role saves the
// event and replaces its couple list in one transaction
// (operator_save_event). Removing an email ends that partner's access at once.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { decideOperatorAccess, mapSaveError, validateSaveEventRequest } from '../_shared/operator-rules.ts'
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

function fail(code: string, message: string, status: number, field?: string): Response {
  return json({ error: field ? { code, message, field } : { code, message } }, status)
}

const notOperator = () => fail('not_operator', 'This console is for the operator.', 403)
const unreachable = () => fail('server_error', 'Could not save the event.', 500)

/** A PostgREST/Postgres error, reduced to what's safe to log (no tokens, no emails). */
function describe(error: unknown): Record<string, unknown> {
  const e = (error ?? {}) as { code?: unknown; name?: unknown }
  return { name: e.name, code: e.code }
}

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

Deno.serve(withCors(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) {
    console.error('save-event: missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY')
    return fail('server_error', 'Event setup is not configured.', 500)
  }

  // The operator gate first, so a stranger learns nothing — not even which
  // field of their body was wrong.
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
  if (decision === 'not_operator') return notOperator()
  if (decision === 'server_error') {
    console.error('save-event: operator check failed', { status: check.status, ...describe(check.error) })
    return unreachable()
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return fail('bad_request', 'Invalid JSON body.', 400, 'body')
  }
  const parsed = validateSaveEventRequest(payload)
  if (!parsed.ok) return fail('bad_request', parsed.message, 400, parsed.field)
  const { eventId, coupleNames, windowOpen, windowClose, coupleEmails } = parsed.value

  const service = createClient(url, serviceKey, { auth: noSession })
  const { data: savedId, error: saveErr } = await service.rpc('operator_save_event', {
    p_event_id: eventId,
    p_couple_names: coupleNames,
    p_window_open: windowOpen,
    p_window_close: windowClose,
    p_emails: coupleEmails,
  })
  if (saveErr) {
    const failure = mapSaveError((saveErr as { code?: unknown }).code)
    if (failure.status >= 500 || failure.code === 'bad_request') {
      // A 500, or a constraint backstop validation should have caught: log it.
      console.error('save-event: save failed', { eventId, ...describe(saveErr) })
    }
    return fail(failure.code, failure.message, failure.status, failure.field)
  }
  if (typeof savedId !== 'string') {
    console.error('save-event: save returned no id', { eventId })
    return unreachable()
  }
  return json({ eventId: savedId })
}))
