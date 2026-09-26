// issue-couple-view-urls — short-lived signed GET URLs for the couple's
// collection (AD-2, couple tier). Authorization is decided by RLS with the
// caller's own JWT (AD-3): the event is read through a user-scoped client, and
// only a session that can see it is this event's couple — so the 2.1 rules
// (JWT email, email-link `amr`) stay the single source of truth. Then the
// service role fetches the storage keys for uploaded shots of that event;
// ids that aren't are simply omitted, as are any that fail to sign. Storage
// keys and tokens never leave the function, and never reach its logs.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  toCoupleViewUrlMap,
  validateCoupleViewRequest,
  VIEW_TTL_SECONDS,
  type CoupleViewableRow,
} from '../_shared/view-rules.ts'
import { decideCoupleAccess } from '../_shared/couple-rules.ts'
import { presignGet } from '../_shared/r2.ts'

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
const unreachable = () => fail('server_error', 'Could not reach the collection.', 500)

/** A PostgREST/Postgres error, reduced to what's safe to log (no tokens, no keys). */
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
    console.error('issue-couple-view-urls: missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY')
    return fail('server_error', 'The collection is not configured.', 500)
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return fail('bad_request', 'Invalid JSON body.', 400)
  }
  const parsed = validateCoupleViewRequest(payload)
  if (!parsed.ok) return fail('bad_request', 'Invalid view request.', 400)
  const { eventId, shotIds } = parsed.value

  // The couple gate, before any key lookup or signing: can this caller's own
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
    console.error('issue-couple-view-urls: event read failed', { status: read.status, ...describe(read.error) })
    return unreachable()
  }

  const service = createClient(url, serviceKey, { auth: noSession })
  const { data: keys, error: keysErr } = await service.rpc('couple_viewable_shot_keys', {
    p_event_id: eventId,
    p_shot_ids: shotIds,
  })
  if (keysErr) {
    console.error('issue-couple-view-urls: key lookup failed', describe(keysErr))
    return unreachable()
  }

  const rows = (keys ?? []) as CoupleViewableRow[]
  let failures = 0
  const urls = await toCoupleViewUrlMap(
    rows,
    (r2Key) => presignGet(r2Key, VIEW_TTL_SECONDS),
    (shotId, error) => {
      failures++
      console.error('issue-couple-view-urls: presign failed', { shotId, ...describe(error) })
    },
  )
  // Some rows failing is partial success (the client retries what's missing);
  // every row failing is a signing outage (e.g. missing R2 config) — say so.
  if (rows.length > 0 && failures === rows.length) {
    return fail('server_error', 'Could not sign view links.', 500)
  }

  return json({ urls, expiresIn: VIEW_TTL_SECONDS })
})
