// issue-montage-url — a short-lived signed GET URL for the event's hosted
// montage (AD-2 couple tier, AD-7: the app only hosts the finished cut). Same
// gate as issue-couple-view-urls: the event is read through RLS with the
// caller's own JWT, so only this event's couple (2.1 email/amr rules) gets
// past it. Then the service role reads `montage_key` — a column no client role
// can select — and signs it. No montage yet is `{ url: null }`, not an error.
// The key and tokens never leave the function, and never reach its logs.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { MONTAGE_TTL_SECONDS, validateMontageRequest } from '../_shared/montage-rules.ts'
import { decideCoupleAccess } from '../_shared/couple-rules.ts'
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

const notCouple = () => fail('not_couple', 'This reveal belongs to another couple.', 403)
const unreachable = () => fail('server_error', 'Could not reach the montage.', 500)

/** A PostgREST/Postgres/signing error, reduced to what's safe to log (no tokens, no keys). */
function describe(error: unknown): Record<string, unknown> {
  const e = (error ?? {}) as { code?: unknown; message?: unknown; name?: unknown }
  return { name: e.name, code: e.code, message: e.message }
}

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

Deno.serve(withCors(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) {
    console.error('issue-montage-url: missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY')
    return fail('server_error', 'The montage is not configured.', 500)
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return fail('bad_request', 'Invalid JSON body.', 400)
  }
  const parsed = validateMontageRequest(payload)
  if (!parsed.ok) return fail('bad_request', 'Invalid montage request.', 400)
  const { eventId } = parsed.value

  // The couple gate, before the key is even read: can this caller's own
  // session read the event? Anon, another couple, a password session or an
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
    console.error('issue-montage-url: event read failed', { status: read.status, ...describe(read.error) })
    return unreachable()
  }

  const service = createClient(url, serviceKey, { auth: noSession })
  const { data: event, error: keyErr } = await service
    .from('events')
    .select('montage_key')
    .eq('id', eventId)
    .maybeSingle()
  if (keyErr) {
    console.error('issue-montage-url: key lookup failed', describe(keyErr))
    return unreachable()
  }

  const key = (event as { montage_key?: unknown } | null)?.montage_key
  // Not hosted yet: the reveal shows "being prepared", never an error.
  if (typeof key !== 'string' || key.trim() === '') return json({ url: null })

  try {
    const signed = await presignGet(key, MONTAGE_TTL_SECONDS)
    return json({ url: signed, expiresIn: MONTAGE_TTL_SECONDS })
  } catch (error) {
    console.error('issue-montage-url: presign failed', { eventId, ...describe(error) })
    return fail('server_error', 'Could not sign the montage link.', 500)
  }
}))
