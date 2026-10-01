// Pure rules for `npm run smoke:prod` (go-live): what to check, and how to
// judge each answer. Unit-tested; scripts/smoke.ts does the network calls.
// Nothing here ever formats a secret or a signed URL — hints name settings only.
// `undefined` for an observed value means "unreachable" (no answer at all).
import { readMontageEnv, type MontageEnv } from './montage-rules.ts'

/** Every Edge Function the app calls (a test keeps this in step with supabase/functions/). */
export const SMOKE_FUNCTIONS = [
  'join-event',
  'issue-upload-url',
  'confirm-upload',
  'issue-view-urls',
  'issue-couple-view-urls',
  'issue-montage-url',
  'set-release',
  'save-event',
  'set-window',
  'issue-export-urls',
] as const

/** The newest migration, and a function it creates (a test keeps these in step with supabase/migrations/). */
export const LATEST_MIGRATION = { prefix: '0010', probe: 'operator_export_shots' } as const

/** Function secrets the deployed functions need; and one that must never be set in production. */
export const REQUIRED_SECRETS = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'ALLOWED_ORIGINS'] as const
export const FORBIDDEN_SECRETS = ['R2_SERVER_ENDPOINT'] as const

export type SmokeEnv = MontageEnv & { appOrigin: string }

export type SmokeEnvResult = { ok: true; value: SmokeEnv } | { ok: false; missing: string[] }

/** A bare origin (scheme://host[:port]) or null — no path, no trailing slash. */
function bareOrigin(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.origin
  } catch {
    return null
  }
}

/**
 * The montage script's server credentials plus APP_ORIGIN (the site, e.g.
 * https://cam.example.com). A malformed APP_ORIGIN is reported like a missing one.
 */
export function readSmokeEnv(env: Record<string, string | undefined>): SmokeEnvResult {
  const base = readMontageEnv(env)
  const raw = (env.APP_ORIGIN ?? '').trim()
  const appOrigin = raw === '' ? null : bareOrigin(raw)
  const missing = [
    ...(base.ok ? [] : base.missing),
    ...(raw === '' ? ['APP_ORIGIN'] : appOrigin === null ? ['APP_ORIGIN (must look like https://cam.example.com)'] : []),
  ]
  if (!base.ok || missing.length > 0 || appOrigin === null) return { ok: false, missing }
  return { ok: true, value: { ...base.value, appOrigin } }
}

/**
 * One result. `warn` marks a hardening gap that doesn't break the night
 * (reported, but it doesn't fail the run); `ok: false` without `warn` blocks go-live.
 */
export type Check = { name: string; ok: boolean; hint?: string; warn?: boolean }

const same = (a: string | null | undefined, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()

/** A service-role call that should have worked: tell a bad key and an outage apart from the real cause. */
export function judgeServiceCall(name: string, status: number | undefined, ok: boolean, causeHint: string): Check {
  if (ok) return { name, ok: true }
  if (status === undefined) return { name, ok: false, hint: 'unreachable — check SUPABASE_URL' }
  if (status === 401 || status === 403) return { name, ok: false, hint: 'refused — check SUPABASE_SERVICE_ROLE_KEY' }
  return { name, ok: false, hint: causeHint }
}

/** Does a body carry our functions' typed error ({ error: { code } })? */
function isTypedError(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown } }
    return typeof parsed?.error?.code === 'string'
  } catch {
    return false
  }
}

/**
 * Deployed and running: a 4xx (a probe with an empty body is refused). A 404 is
 * "not deployed" only when it isn't one of our own typed errors — join-event,
 * for one, answers an unknown event with its own 404. 5xx = crashing.
 */
export function judgeFunction(name: string, status: number | undefined, body = ''): Check {
  const label = `function ${name}`
  if (status === undefined) return { name: label, ok: false, hint: 'unreachable — check SUPABASE_URL' }
  if (status === 404 && !isTypedError(body)) {
    return { name: label, ok: false, hint: `not deployed — npx supabase functions deploy ${name}` }
  }
  if (status >= 500) {
    return { name: label, ok: false, hint: `deployed but failing (${status}) — Supabase → Edge Functions → ${name} → Logs` }
  }
  return { name: label, ok: true }
}

export type CorsProbe = { fn: string; site: string | null | undefined; foreign: string | null | undefined }

/**
 * Function CORS across every function. The site refused by any function
 * BLOCKS (that call would fail in every browser). Allowing everyone (`*`, or a
 * foreign origin) only WARNS: the ALLOWED_ORIGINS lockdown isn't in effect, but
 * every function still checks its own token.
 */
export function judgeFunctionsCors(appOrigin: string, probes: CorsProbe[]): Check {
  const name = 'functions answer the site, and only the site (ALLOWED_ORIGINS)'
  const unreachable = probes.filter((p) => p.site === undefined || p.foreign === undefined).map((p) => p.fn)
  if (unreachable.length > 0) return { name, ok: false, hint: `no answer from ${unreachable.join(', ')} — check SUPABASE_URL` }
  const refused = probes.filter((p) => p.site !== '*' && !same(p.site, appOrigin)).map((p) => p.fn)
  if (refused.length > 0) {
    return { name, ok: false, hint: `${refused.join(', ')} refuse the site — ALLOWED_ORIGINS must include ${appOrigin}, and redeploy` }
  }
  const open = probes.filter((p) => p.site === '*' || p.foreign !== null).map((p) => p.fn)
  if (open.length > 0) {
    return { name, ok: false, warn: true, hint: `other sites are allowed too — set the Function secret ALLOWED_ORIGINS=${appOrigin}` }
  }
  return { name, ok: true }
}

/**
 * The database API must accept the guest's `x-device-token` header from the
 * site's browsers (My Roll reads the guest's own shots with it, 1.6).
 */
export function judgeRestHeaders(
  appOrigin: string,
  allowOrigin: string | null | undefined,
  allowHeaders: string | null | undefined,
): Check {
  const name = 'database API accepts the guest header (x-device-token) from the site'
  if (allowOrigin === undefined) return { name, ok: false, hint: 'unreachable — check SUPABASE_URL' }
  const originOk = allowOrigin === '*' || same(allowOrigin, appOrigin)
  const headers = (allowHeaders ?? '').toLowerCase().split(',').map((h) => h.trim())
  if (originOk && (headers.includes('x-device-token') || headers.includes('*'))) return { name, ok: true }
  return {
    name,
    ok: false,
    hint: 'browsers can’t send x-device-token — My Roll would show only shots still on the phone; check the project’s API CORS settings',
  }
}

/**
 * R2 CORS for one method: the site (or `*`) allowed, the method listed when the
 * bucket lists methods, and — for PUT — the content-type header every guest
 * upload sends.
 */
export function judgeBucketCors(
  appOrigin: string,
  method: 'PUT' | 'GET',
  allowOrigin: string | null | undefined,
  allowMethods: string | null | undefined,
  allowHeaders: string | null | undefined,
): Check {
  const name = `storage CORS allows ${method} from the site`
  if (allowOrigin === undefined) return { name, ok: false, hint: 'unreachable — check R2_ENDPOINT' }
  const list = (v: string | null | undefined) => (v ?? '').toLowerCase().split(',').map((x) => x.trim())
  const originOk = allowOrigin === '*' || same(allowOrigin, appOrigin)
  const methodOk = allowMethods == null || list(allowMethods).includes(method.toLowerCase()) || list(allowMethods).includes('*')
  const headersOk = method === 'GET' || list(allowHeaders).includes('content-type') || list(allowHeaders).includes('*')
  if (originOk && methodOk && headersOk) return { name, ok: true }
  return {
    name,
    ok: false,
    hint: `R2 bucket → Settings → CORS: AllowedOrigins ["${appOrigin}"], AllowedMethods ["PUT","GET"], AllowedHeaders ["content-type"]`,
  }
}

/** The site serves the app shell for any deep link (SPA fallback via public/_redirects). */
export function judgeShell(status: number | undefined, contentType: string | null, body: string): Check {
  const name = 'site serves the app on a deep link (/j/…)'
  if (status === 200 && (contentType ?? '').includes('text/html') && body.includes('id="root"')) return { name, ok: true }
  return {
    name,
    ok: false,
    hint:
      status === undefined
        ? 'unreachable — check APP_ORIGIN and the Pages deploy'
        : `got ${status} — check the Pages deploy and that public/_redirects shipped`,
  }
}

/** The script a page loads first (Vite's entry chunk), from the shell's HTML. */
export function entryScript(html: string): string | null {
  return /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1] ?? /<script[^>]+src="([^"]+)"[^>]+type="module"/.exec(html)?.[1] ?? null
}

/** The live bundle talks to THIS Supabase project (VITE_ values are baked in at build time). */
export function judgeSiteConfig(bundle: string | null | undefined, supabaseUrl: string): Check {
  const name = 'site is built against this Supabase project'
  if (bundle === undefined || bundle === null) return { name, ok: false, hint: 'couldn’t load the site’s script — check the Pages deploy' }
  let host = supabaseUrl
  try {
    host = new URL(supabaseUrl).host
  } catch {
    // compared as written
  }
  if (bundle.includes(host)) return { name, ok: true }
  return { name, ok: false, hint: 'set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in Cloudflare Pages, then redeploy' }
}

/** Auth settings readable from the API: email sign-in on, sign-ups on (the hook gates them), confirmations ON. */
export function judgeAuthSettings(settings: unknown): Check {
  const name = 'auth: email sign-in on, confirm email ON'
  if (settings === undefined) return { name, ok: false, hint: 'unreachable — check SUPABASE_URL' }
  const s = (settings ?? {}) as { external?: { email?: unknown }; disable_signup?: unknown; mailer_autoconfirm?: unknown }
  if (s.external?.email !== true) return { name, ok: false, hint: 'Authentication → Sign In / Providers → Email: enable it' }
  if (s.disable_signup === true) {
    return { name, ok: false, hint: 'allow new users (the Before User Created hook decides who) — first sign-ins create the account' }
  }
  if (s.mailer_autoconfirm !== false) {
    return { name, ok: false, hint: 'Authentication → Email: turn Confirm email ON (Story 2.1’s security relies on it)' }
  }
  return { name, ok: true }
}

/** Function secret names (from `supabase secrets list`), or null when they couldn't be listed. */
export function judgeSecrets(names: string[] | null): Check {
  const name = 'function secrets set (R2_*, ALLOWED_ORIGINS)'
  if (names === null) {
    return { name, ok: false, warn: true, hint: 'couldn’t list them — run from the linked repo (npx supabase link), or check: npx supabase secrets list' }
  }
  const missing = REQUIRED_SECRETS.filter((s) => !names.includes(s))
  if (missing.length > 0) {
    return { name, ok: false, hint: `missing ${missing.join(', ')} — npx supabase secrets set --env-file supabase/functions/.env.production` }
  }
  const forbidden = FORBIDDEN_SECRETS.filter((s) => names.includes(s))
  if (forbidden.length > 0) return { name, ok: false, hint: `remove ${forbidden.join(', ')} — npx supabase secrets unset ${forbidden.join(' ')}` }
  return { name, ok: true }
}

/**
 * Secret names out of `supabase secrets list -o json` — an array of {name}
 * objects (or, tolerated, an object keyed by name) — or null if unreadable.
 * Only names are read; the CLI shows digests, never values.
 */
export function parseSecretNames(stdout: string): string[] | null {
  try {
    const parsed = JSON.parse(stdout.slice(stdout.search(/[[{]/))) as unknown
    if (Array.isArray(parsed)) {
      return parsed.map((r) => (r as { name?: unknown })?.name).filter((n): n is string => typeof n === 'string')
    }
    if (parsed && typeof parsed === 'object') return Object.keys(parsed)
    return null
  } catch {
    return null
  }
}

/** "✓ name", "⚠ name — hint" or "✗ name — hint" lines plus a verdict; ok unless something blocks. */
export function formatReport(checks: Check[]): { text: string; ok: boolean } {
  const mark = (c: Check) => (c.ok ? '✓' : c.warn ? '⚠' : '✗')
  const lines = checks.map((c) => `${mark(c)} ${c.name}${!c.ok && c.hint ? ` — ${c.hint}` : ''}`)
  const failed = checks.filter((c) => !c.ok && !c.warn).length
  const warned = checks.filter((c) => !c.ok && c.warn).length
  const ok = failed === 0 && checks.length > 0
  const tail = warned > 0 ? ` (${warned} warning${warned === 1 ? '' : 's'})` : ''
  lines.push('', ok ? `Ready: ${checks.length - warned} of ${checks.length} checks passed${tail}.` : `${failed} of ${checks.length} checks failed${tail}.`)
  return { text: lines.join('\n'), ok }
}
