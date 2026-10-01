// Go-live smoke test — run after deploying (docs/GO-LIVE.md step 8):
//
//   npm run smoke:prod
//
// Reads supabase/functions/.env.production (the same file as montage:upload
// and operator:add, plus APP_ORIGIN) and checks the live deploy:
//   - migrations applied; an operator exists; Auth email settings;
//   - every Edge Function deployed and running, with its secrets, answering the
//     site and only the site;
//   - the database API accepting the guest header;
//   - R2 keys working (a test object written, read back and deleted) and R2
//     CORS allowing the browser's PUT and GET;
//   - the site serving the app, built against this Supabase project.
// Prints ✓ / ⚠ / ✗ per check and exits 1 on any ✗. Each check is guarded, so
// one crash is reported in place and the rest still run. Never prints secrets
// or signed URLs.
import { spawnSync } from 'node:child_process'
import { AwsClient } from 'aws4fetch'
import { withExpiry } from '../supabase/functions/_shared/view-rules.ts'
import { objectUrl } from './montage-rules.ts'
import {
  entryScript,
  formatReport,
  judgeAuthSettings,
  judgeBucketCors,
  judgeFunction,
  judgeFunctionsCors,
  judgeRestHeaders,
  judgeSecrets,
  judgeServiceCall,
  judgeShell,
  judgeSiteConfig,
  LATEST_MIGRATION,
  parseSecretNames,
  readSmokeEnv,
  SMOKE_FUNCTIONS,
  type Check,
  type CorsProbe,
} from './smoke-rules.ts'

const FOREIGN_ORIGIN = 'https://smoke-test-foreign.invalid'
const TIMEOUT_MS = 15_000

/** fetch that never throws: no answer at all (network, DNS, timeout) is null. */
async function call(url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    return null
  }
}

/** Drain a response we only read headers from. */
const done = async (res: Response | null) => {
  await res?.body?.cancel().catch(() => {})
}

/** Run one check; a crash becomes a ✗ with the error's name/message (never a request dump). */
async function guard(checks: Check[], name: string, fn: () => Promise<Check | Check[]>) {
  try {
    const result = await fn()
    checks.push(...(Array.isArray(result) ? result : [result]))
  } catch (error) {
    const e = error as { name?: unknown; message?: unknown }
    checks.push({ name, ok: false, hint: `the check itself failed: ${String(e?.name ?? 'Error')}: ${String(e?.message ?? '')}`.slice(0, 200) })
  }
}

async function main(): Promise<number> {
  const env = readSmokeEnv(process.env)
  if (!env.ok) {
    console.error(`Missing ${env.missing.join(', ')}.`)
    console.error('Set them in supabase/functions/.env.production — see docs/GO-LIVE.md step 5.')
    return 1
  }
  const cfg = env.value
  const api = cfg.supabaseUrl.replace(/\/+$/, '')
  const service = { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}` }
  const checks: Check[] = []

  // Database: the newest migration's function exists.
  await guard(checks, 'database migrations applied', async () => {
    const res = await call(`${api}/rest/v1/rpc/${LATEST_MIGRATION.probe}`, {
      method: 'POST',
      headers: { ...service, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_event_id: '00000000-0000-0000-0000-000000000000' }),
    })
    await done(res)
    return judgeServiceCall(`database migrations applied (through ${LATEST_MIGRATION.prefix})`, res?.status, !!res?.ok, 'run npx supabase db push')
  })

  // An operator is on the list (the email itself is never printed).
  await guard(checks, 'an operator email is on the list', async () => {
    const res = await call(`${api}/rest/v1/operators?select=email&limit=1`, { headers: service })
    const rows = res?.ok ? ((await res.json().catch(() => null)) as unknown) : null
    const has = Array.isArray(rows) && rows.length > 0
    if (res?.ok && !has) {
      return { name: 'an operator email is on the list', ok: false, hint: 'npm run operator:add:prod -- <your-email>' }
    }
    await done(res)
    return judgeServiceCall('an operator email is on the list', res?.status, has, 'npm run operator:add:prod -- <your-email>')
  })

  // Auth settings the API exposes (the hook and Site URL stay manual — GO-LIVE step 3).
  await guard(checks, 'auth settings', async () => {
    const res = await call(`${api}/auth/v1/settings`, { headers: { apikey: cfg.serviceRoleKey } })
    return judgeAuthSettings(res ? await res.json().catch(() => null) : undefined)
  })

  // Every function deployed and running. Called with the service key so the
  // gateway routes the request; an empty body is refused with a 4xx.
  await guard(checks, 'functions deployed', async () => {
    const results: Check[] = []
    for (const fn of SMOKE_FUNCTIONS) {
      const probe = () =>
        call(`${api}/functions/v1/${fn}`, {
          method: 'POST',
          headers: { ...service, 'Content-Type': 'application/json' },
          body: '{}',
        })
      const res = (await probe()) ?? (await probe()) // one retry: a cold start can be slow
      results.push(judgeFunction(fn, res?.status, res ? await res.text().catch(() => '') : ''))
    }
    return results
  })

  // The functions' secrets (names only; the CLI never shows values).
  await guard(checks, 'function secrets set', async () => {
    // A fixed command string (no user input), run through the shell so `npx` resolves on Windows too.
    const out = spawnSync('npx supabase secrets list -o json', { shell: true, encoding: 'utf8', timeout: 60_000 })
    return judgeSecrets(out.status === 0 ? parseSecretNames(out.stdout ?? '') : null)
  })

  // Every function answers the site, and only the site (ALLOWED_ORIGINS).
  await guard(checks, 'functions answer the site, and only the site', async () => {
    const preflight = async (fn: string, origin: string) => {
      const res = await call(`${api}/functions/v1/${fn}`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, apikey, content-type',
        },
      })
      await done(res)
      return res ? res.headers.get('access-control-allow-origin') : undefined
    }
    const probes: CorsProbe[] = []
    for (const fn of SMOKE_FUNCTIONS) {
      probes.push({ fn, site: await preflight(fn, cfg.appOrigin), foreign: await preflight(fn, FOREIGN_ORIGIN) })
    }
    return judgeFunctionsCors(cfg.appOrigin, probes)
  })

  // The database API takes the guest's x-device-token header from the site (My Roll).
  await guard(checks, 'database API accepts the guest header', async () => {
    const res = await call(`${api}/rest/v1/shots?select=client_shot_id&limit=1`, {
      method: 'OPTIONS',
      headers: {
        Origin: cfg.appOrigin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'apikey, authorization, x-device-token',
      },
    })
    await done(res)
    return judgeRestHeaders(
      cfg.appOrigin,
      res ? res.headers.get('access-control-allow-origin') : undefined,
      res?.headers.get('access-control-allow-headers') ?? null,
    )
  })

  // R2: write, read back and delete a tiny object; then the bucket's CORS.
  const r2 = new AwsClient({
    accessKeyId: cfg.r2AccessKeyId,
    secretAccessKey: cfg.r2SecretAccessKey,
    service: 's3',
    region: cfg.r2Region,
  })
  const key = `smoke/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.txt`
  const target = objectUrl(cfg.r2Endpoint, cfg.r2Bucket, key)
  const signed = async (method: 'PUT' | 'GET' | 'DELETE', headers: Record<string, string> = {}) =>
    (await r2.sign(withExpiry(target, 300), { method, headers, aws: { signQuery: true, allHeaders: method === 'PUT' } })).url
  let attemptedWrite = false
  try {
    await guard(checks, 'storage keys write and read a test object', async () => {
      const name = 'storage keys write and read a test object'
      const payload = `dispo-retro-cam smoke ${new Date().toISOString()}`
      attemptedWrite = true
      const put = await call(await signed('PUT', { 'content-type': 'text/plain' }), {
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body: payload,
      })
      await done(put)
      if (!put) return { name, ok: false, hint: 'unreachable — check R2_ENDPOINT' }
      if (!put.ok) return { name, ok: false, hint: `write refused (${put.status}) — check R2_* keys, bucket name and token permissions` }
      const get = await call(await signed('GET'))
      if (!get) return { name, ok: false, hint: 'read back: unreachable — check R2_ENDPOINT' }
      const back = get.ok ? await get.text() : (await done(get), null)
      return back === payload
        ? { name, ok: true }
        : { name, ok: false, hint: `read back failed (${get.status}) — check the token has Object Read` }
    })

    for (const method of ['PUT', 'GET'] as const) {
      await guard(checks, `storage CORS allows ${method} from the site`, async () => {
        const res = await call(await signed(method, method === 'PUT' ? { 'content-type': 'text/plain' } : {}), {
          method: 'OPTIONS',
          headers: {
            Origin: cfg.appOrigin,
            'Access-Control-Request-Method': method,
            ...(method === 'PUT' ? { 'Access-Control-Request-Headers': 'content-type' } : {}),
          },
        })
        await done(res)
        return judgeBucketCors(
          cfg.appOrigin,
          method,
          res ? res.headers.get('access-control-allow-origin') : undefined,
          res?.headers.get('access-control-allow-methods') ?? null,
          res?.headers.get('access-control-allow-headers') ?? null,
        )
      })
    }
  } finally {
    // Always try to remove the test object — even when the PUT's answer was lost.
    if (attemptedWrite) {
      const del = await call(await signed('DELETE'), { method: 'DELETE' }).catch(() => null)
      await done(del)
      if (!del?.ok && del?.status !== 404) {
        console.error('Note: couldn’t confirm the smoke test object under smoke/ was deleted — check the bucket.')
      }
    }
  }

  // The site serves the app on a deep link (QR codes land on /j/<id>), built against this project.
  await guard(checks, 'site', async () => {
    const shell = await call(`${cfg.appOrigin}/j/00000000-0000-4000-8000-000000000000`)
    const html = shell ? await shell.text() : ''
    const results: Check[] = [judgeShell(shell?.status, shell?.headers.get('content-type') ?? null, html)]
    const src = entryScript(html)
    const bundle = src ? await call(new URL(src, cfg.appOrigin).toString()) : null
    results.push(judgeSiteConfig(bundle?.ok ? await bundle.text() : null, cfg.supabaseUrl))
    return results
  })

  const report = formatReport(checks)
  console.log(report.text)
  return report.ok ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (error) => {
    const e = error as { name?: unknown; message?: unknown }
    console.error(`Smoke test crashed: ${String(e?.name ?? 'Error')}: ${String(e?.message ?? '')}`)
    process.exit(1)
  },
)
