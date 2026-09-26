// set-release — the couple's "okay to share" switch (FR15, AD-3: a privileged
// write, so it goes only through this function; no client role can update
// `events`). Same gate as issue-montage-url: the event is read through RLS
// with the caller's own JWT, so only this event's couple (2.1 email/amr rules)
// gets past it. Then the service role writes the explicit value — never a
// toggle — to that one row. Public sharing is deferred: the flag opens nothing.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { validateReleaseRequest } from '../_shared/release-rules.ts'
import { decideCoupleAccess } from '../_shared/couple-rules.ts'

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

const notCouple = () => fail('not_couple', 'This reveal belongs to another couple.', 403)
const unreachable = () => fail('server_error', 'Could not save the sharing setting.', 500)

/** A PostgREST/Postgres error, reduced to what's safe to log (no tokens). */
function describe(error: unknown): Record<string, unknown> {
  const e = (error ?? {}) as { code?: unknown; message?: unknown; name?: unknown }
  return { name: e.name, code: e.code, message: e.message }
}

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) {
    console.error('set-release: missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY')
    return fail('server_error', 'Sharing is not configured.', 500)
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return fail('bad_request', 'Invalid JSON body.', 400)
  }
  const parsed = validateReleaseRequest(payload)
  if (!parsed.ok) return fail('bad_request', 'Invalid sharing request.', 400)
  const { eventId, released } = parsed.value

  // The couple gate, before anything is written: can this caller's own session
  // read the event? Anon, another couple, a password session, a guest or an
  // expired token all see no row.
  const authorization = req.headers.get('Authorization')
  let read = { data: null as unknown, error: null as unknown, status: 0 }
  if (authorization) {
    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: noSession,
    })
    const { data, error, status } = await asCaller.from('events').select('id').eq('id', eventId).maybeSingle()
    read = { data, error, status }
  }
  const decision = decideCoupleAccess({ hasAuthHeader: !!authorization, ...read })
  if (decision === 'not_couple') return notCouple()
  if (decision === 'server_error') {
    console.error('set-release: event read failed', { status: read.status, ...describe(read.error) })
    return unreachable()
  }

  const service = createClient(url, serviceKey, { auth: noSession })
  const { data: row, error: writeErr } = await service
    .from('events')
    .update({ released })
    .eq('id', eventId)
    .select('released')
    .maybeSingle()
  if (writeErr) {
    console.error('set-release: update failed', { eventId, ...describe(writeErr) })
    return unreachable()
  }
  const saved = (row as { released?: unknown } | null)?.released
  if (typeof saved !== 'boolean') {
    // The gate saw the event but the write matched nothing (deleted in between).
    console.error('set-release: update matched no row', { eventId })
    return unreachable()
  }
  return json({ released: saved })
})
