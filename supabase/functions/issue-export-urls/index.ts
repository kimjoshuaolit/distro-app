// issue-export-urls — short-lived signed GETs for the operator's Download all
// (Story 3.4, FR18, AD-2). Same gate as set-window, checked first: the
// database's is_operator() with the caller's own JWT. Then the service role
// looks up at most 100 storage keys of uploaded shots of that event
// (operator_export_keys) and, if asked, the hosted montage, and signs 10-minute
// links. A row that fails to sign is omitted (the client retries it); keys and
// tokens never leave the function, and never reach its logs.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { decideOperatorAccess } from '../_shared/operator-rules.ts'
import { EXPORT_TTL_SECONDS, montageLink, validateExportRequest } from '../_shared/export-rules.ts'
import { toCoupleViewUrlMap, type CoupleViewableRow } from '../_shared/view-rules.ts'
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

/** A PostgREST/Postgres error, reduced to what's safe to log (no tokens, no keys). */
function describe(error: unknown): Record<string, unknown> {
  const e = (error ?? {}) as { code?: unknown; name?: unknown }
  return { name: e.name, code: e.code }
}

const unreachable = () => fail('server_error', 'Could not sign download links.', 500)

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) {
    console.error('issue-export-urls: missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY')
    return fail('server_error', 'Download all is not configured.', 500)
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
    console.error('issue-export-urls: operator check failed', { status: check.status, ...describe(check.error) })
    return unreachable()
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return fail('bad_request', 'Invalid JSON body.', 400)
  }
  const parsed = validateExportRequest(payload)
  if (!parsed.ok) return fail('bad_request', 'Invalid download request.', 400)
  const { eventId, shotIds, montage } = parsed.value

  const service = createClient(url, serviceKey, { auth: noSession })

  let urls: Record<string, string> = {}
  if (shotIds.length > 0) {
    const { data: keys, error: keysErr } = await service.rpc('operator_export_keys', {
      p_event_id: eventId,
      p_shot_ids: shotIds,
    })
    if (keysErr) {
      console.error('issue-export-urls: key lookup failed', describe(keysErr))
      return unreachable()
    }
    const rows = (keys ?? []) as CoupleViewableRow[]
    let failures = 0
    urls = await toCoupleViewUrlMap(
      rows,
      (r2Key) => presignGet(r2Key, EXPORT_TTL_SECONDS),
      (shotId, error) => {
        failures++
        console.error('issue-export-urls: presign failed', { shotId, ...describe(error) })
      },
    )
    // Some rows failing is partial success (the client retries); all of them
    // failing is a signing outage (e.g. missing R2 config) — say so.
    if (rows.length > 0 && failures === rows.length) return unreachable()
  }

  const body: {
    urls: Record<string, string>
    expiresIn: number
    montage?: { url: string; ext: string } | null
  } = { urls, expiresIn: EXPORT_TTL_SECONDS }
  if (montage) {
    const { data: event, error: eventErr } = await service
      .from('events')
      .select('montage_key')
      .eq('id', eventId)
      .maybeSingle()
    if (eventErr) {
      console.error('issue-export-urls: montage lookup failed', describe(eventErr))
      return unreachable()
    }
    // None hosted (or no such event) → null. The extension names the saved
    // file; the key itself never leaves. A failed signing is an error.
    try {
      body.montage = await montageLink(
        (event as { montage_key?: unknown } | null)?.montage_key,
        (key) => presignGet(key, EXPORT_TTL_SECONDS),
      )
    } catch (error) {
      console.error('issue-export-urls: montage presign failed', { eventId, ...describe(error) })
      return unreachable()
    }
  }

  return json(body)
})
