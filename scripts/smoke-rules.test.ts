import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
} from './smoke-rules'

const SITE = 'https://cam.example.com'
const fullEnv = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'secret-service',
  R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  R2_BUCKET: 'b',
  R2_ACCESS_KEY_ID: 'id',
  R2_SECRET_ACCESS_KEY: 'secret-r2',
  APP_ORIGIN: `${SITE}/`,
}

describe('readSmokeEnv', () => {
  it('reads the montage credentials plus APP_ORIGIN (as a bare origin)', () => {
    expect(readSmokeEnv(fullEnv)).toMatchObject({ ok: true, value: { appOrigin: SITE, r2Region: 'auto' } })
  })
  it('names what is missing or malformed — never values', () => {
    expect(readSmokeEnv({ ...fullEnv, APP_ORIGIN: ' ', R2_BUCKET: undefined })).toEqual({ ok: false, missing: ['R2_BUCKET', 'APP_ORIGIN'] })
    for (const bad of ['cam.example.com', 'ftp://cam.example.com']) {
      const r = readSmokeEnv({ ...fullEnv, APP_ORIGIN: bad })
      expect(r.ok).toBe(false)
      expect(JSON.stringify(r)).not.toContain('secret')
    }
  })
  it('a pasted URL with a path is reduced to its origin', () => {
    expect(readSmokeEnv({ ...fullEnv, APP_ORIGIN: `${SITE}/operator` })).toMatchObject({ ok: true, value: { appOrigin: SITE } })
  })
})

describe('kept in step with the repo', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  it('SMOKE_FUNCTIONS lists exactly the functions in supabase/functions/', () => {
    const dirs = readdirSync(`${root}supabase/functions`, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
      .map((d) => d.name)
      .sort()
    expect([...SMOKE_FUNCTIONS].sort()).toEqual(dirs)
  })
  it('LATEST_MIGRATION is the newest migration, and it creates the probed function', () => {
    const files = readdirSync(`${root}supabase/migrations`).filter((f) => f.endsWith('.sql')).sort()
    const newest = files.at(-1)!
    expect(newest.slice(0, 4)).toBe(LATEST_MIGRATION.prefix)
    expect(readFileSync(`${root}supabase/migrations/${newest}`, 'utf8')).toContain(`function public.${LATEST_MIGRATION.probe}(`)
  })
  it('every function is wrapped in withCors (no un-wrapped Deno.serve)', () => {
    for (const fn of SMOKE_FUNCTIONS) {
      const src = readFileSync(`${root}supabase/functions/${fn}/index.ts`, 'utf8')
      expect(src, fn).toContain('Deno.serve(withCors(')
      expect(src, fn).not.toContain("'Access-Control-Allow-Origin'")
    }
  })
})

describe('judgeServiceCall', () => {
  it('tells a bad key and an outage apart from the real cause', () => {
    expect(judgeServiceCall('x', 200, true, 'cause').ok).toBe(true)
    expect(judgeServiceCall('x', 401, false, 'cause').hint).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(judgeServiceCall('x', 403, false, 'cause').hint).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(judgeServiceCall('x', undefined, false, 'cause').hint).toContain('unreachable')
    expect(judgeServiceCall('x', 404, false, 'run db push').hint).toBe('run db push')
  })
})

describe('judgeFunction', () => {
  it('a 4xx means deployed and running; 404 missing; 5xx crashing', () => {
    expect(judgeFunction('join-event', 401)).toEqual({ name: 'function join-event', ok: true })
    expect(judgeFunction('join-event', 400).ok).toBe(true)
    expect(judgeFunction('set-window', 404)).toMatchObject({ ok: false, hint: expect.stringContaining('functions deploy set-window') })
    expect(judgeFunction('set-window', 404, 'Function not found').ok).toBe(false)
    expect(judgeFunction('set-window', 404, '{"code":"NOT_FOUND","message":"Requested function was not found"}').ok).toBe(false)
    // join-event's own "unknown event" 404 means it IS deployed
    expect(judgeFunction('join-event', 404, '{"error":{"code":"event_not_found","message":"x"}}').ok).toBe(true)
    expect(judgeFunction('set-window', 503)).toMatchObject({ ok: false, hint: expect.stringContaining('Logs') })
    expect(judgeFunction('set-window', undefined)).toMatchObject({ ok: false, hint: expect.stringContaining('unreachable') })
  })
})

describe('judgeFunctionsCors', () => {
  const probe = (fn: string, site: string | null | undefined, foreign: string | null | undefined = null) => ({ fn, site, foreign })
  it('passes when every function names the site and refuses a foreign origin', () => {
    expect(judgeFunctionsCors(SITE, [probe('a', SITE), probe('b', SITE)]).ok).toBe(true)
  })
  it('any function refusing the site BLOCKS, and names it', () => {
    const r = judgeFunctionsCors(SITE, [probe('a', SITE), probe('confirm-upload', null)])
    expect(r).toMatchObject({ ok: false, hint: expect.stringContaining('confirm-upload') })
    expect(r.warn).toBeUndefined()
  })
  it('everyone allowed only WARNS; no answer BLOCKS as unreachable', () => {
    expect(judgeFunctionsCors(SITE, [probe('a', '*', '*')])).toMatchObject({ ok: false, warn: true, hint: expect.stringContaining('ALLOWED_ORIGINS=') })
    expect(judgeFunctionsCors(SITE, [probe('a', SITE, 'https://evil.example')])).toMatchObject({ ok: false, warn: true })
    expect(judgeFunctionsCors(SITE, [probe('a', undefined)])).toMatchObject({ ok: false, hint: expect.stringContaining('no answer from a') })
  })
})

describe('judgeRestHeaders', () => {
  it('needs the site and the x-device-token header allowed', () => {
    expect(judgeRestHeaders(SITE, '*', 'authorization, apikey, x-device-token').ok).toBe(true)
    expect(judgeRestHeaders(SITE, SITE, '*').ok).toBe(true)
    expect(judgeRestHeaders(SITE, '*', 'authorization, apikey')).toMatchObject({ ok: false, hint: expect.stringContaining('My Roll') })
    expect(judgeRestHeaders(SITE, null, 'x-device-token').ok).toBe(false)
    expect(judgeRestHeaders(SITE, undefined, null).hint).toContain('unreachable')
  })
})

describe('judgeBucketCors', () => {
  it('needs the site (or *), the method, and content-type for PUT', () => {
    expect(judgeBucketCors(SITE, 'PUT', SITE, 'PUT, GET', 'content-type').ok).toBe(true)
    expect(judgeBucketCors(SITE, 'GET', '*', null, null).ok).toBe(true)
    expect(judgeBucketCors(SITE, 'GET', SITE, 'PUT', null)).toMatchObject({ ok: false, hint: expect.stringContaining('"GET"') })
    expect(judgeBucketCors(SITE, 'PUT', SITE, 'PUT', null)).toMatchObject({ ok: false, hint: expect.stringContaining('content-type') })
    expect(judgeBucketCors(SITE, 'PUT', null, null, null).ok).toBe(false)
    expect(judgeBucketCors(SITE, 'PUT', undefined, null, null).hint).toContain('R2_ENDPOINT')
  })
})

describe('judgeShell / entryScript / judgeSiteConfig', () => {
  const html = '<html><head><script type="module" crossorigin src="/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>'
  it('wants the app’s HTML on a deep link', () => {
    expect(judgeShell(200, 'text/html; charset=utf-8', html).ok).toBe(true)
    expect(judgeShell(404, 'text/html', 'Not found')).toMatchObject({ ok: false, hint: expect.stringContaining('_redirects') })
    expect(judgeShell(200, 'application/json', '{}').ok).toBe(false)
    expect(judgeShell(undefined, null, '')).toMatchObject({ ok: false, hint: expect.stringContaining('unreachable') })
  })
  it('finds the entry script', () => {
    expect(entryScript(html)).toBe('/assets/index-abc.js')
    expect(entryScript('<script src="/a.js" type="module"></script>')).toBe('/a.js')
    expect(entryScript('<p>no script</p>')).toBeNull()
  })
  it('the bundle must point at this project', () => {
    expect(judgeSiteConfig('const u="https://x.supabase.co"', 'https://x.supabase.co').ok).toBe(true)
    expect(judgeSiteConfig('const u="http://127.0.0.1:54321"', 'https://x.supabase.co')).toMatchObject({ ok: false, hint: expect.stringContaining('redeploy') })
    expect(judgeSiteConfig(null, 'https://x.supabase.co').ok).toBe(false)
  })
})

describe('judgeAuthSettings', () => {
  const good = { external: { email: true }, disable_signup: false, mailer_autoconfirm: false }
  it('email on, sign-ups allowed (the hook gates), confirm email ON', () => {
    expect(judgeAuthSettings(good).ok).toBe(true)
    expect(judgeAuthSettings({ ...good, mailer_autoconfirm: true }).hint).toContain('Confirm email ON')
    expect(judgeAuthSettings({ ...good, disable_signup: true }).hint).toContain('hook')
    expect(judgeAuthSettings({ ...good, external: { email: false } }).hint).toContain('Email')
    expect(judgeAuthSettings(undefined).hint).toContain('unreachable')
  })
})

describe('judgeSecrets / parseSecretNames', () => {
  it('needs the R2 secrets and ALLOWED_ORIGINS; never the local-only endpoint', () => {
    const all = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'ALLOWED_ORIGINS', 'SUPABASE_URL']
    expect(judgeSecrets(all).ok).toBe(true)
    expect(judgeSecrets(all.filter((n) => n !== 'R2_BUCKET'))).toMatchObject({ ok: false, hint: expect.stringContaining('R2_BUCKET') })
    expect(judgeSecrets([...all, 'R2_SERVER_ENDPOINT'])).toMatchObject({ ok: false, hint: expect.stringContaining('unset R2_SERVER_ENDPOINT') })
    expect(judgeSecrets(null)).toMatchObject({ ok: false, warn: true })
  })
  it('reads names from the CLI’s JSON (array or keyed object), tolerating a banner line', () => {
    expect(parseSecretNames('[{"name":"R2_BUCKET","value":"abc"},{"name":"ALLOWED_ORIGINS"}]')).toEqual(['R2_BUCKET', 'ALLOWED_ORIGINS'])
    expect(parseSecretNames('Using project ref x\n{"R2_BUCKET":"digest"}')).toEqual(['R2_BUCKET'])
    expect(parseSecretNames('not linked')).toBeNull()
  })
})

describe('formatReport', () => {
  it('lists every check with a verdict; a ✗ fails the run', () => {
    const r = formatReport([{ name: 'a', ok: true }, { name: 'b', ok: false, hint: 'fix b' }])
    expect(r.ok).toBe(false)
    expect(r.text).toBe('✓ a\n✗ b — fix b\n\n1 of 2 checks failed.')
    expect(formatReport([{ name: 'a', ok: true }])).toEqual({ text: '✓ a\n\nReady: 1 of 1 checks passed.', ok: true })
    expect(formatReport([]).ok).toBe(false)
  })
  it('a warning is shown but doesn’t fail the run', () => {
    const r = formatReport([{ name: 'a', ok: true }, { name: 'w', ok: false, warn: true, hint: 'tighten w' }])
    expect(r).toEqual({ text: '✓ a\n⚠ w — tighten w\n\nReady: 1 of 2 checks passed (1 warning).', ok: true })
  })
})
