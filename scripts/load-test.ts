// Guest load test: simulates a crowd of guests using the camera at once, over
// the same API calls the app makes (no phones, no browser).
//
//   npm run load:test -- <eventId>                      (local Supabase)
//   npm run load:test:prod -- <eventId> --live          (production)
//
// Each simulated guest joins (spread over --ramp seconds, like QR scans), then
// every guest takes a photo at the same instant (the first-kiss burst), then
// works through the rest of its 25 photos + 5 clips with short random pauses:
// reserve → PUT to storage → confirm, retrying transient failures the way the
// app's upload queue does. Along the way it checks that the allotment holds
// (the extra photo and clip are refused), that a shot sent twice at once is
// only counted once, that each guest reads back exactly its own roll, and
// that saved shots can be viewed back.
//
// Uses only public values (the Supabase URL and anon key every phone gets), so
// it can't do anything a guest couldn't. It does create real guests and shots
// in the event you name: point it at a TEST event, never the wedding's.
// Uploads are placeholder bytes, not real pictures.
import {
  backoffMs,
  CLIPS,
  formatBytes,
  formatMs,
  isLocalUrl,
  isTransient,
  parseLoadArgs,
  PHOTOS,
  readLoadEnv,
  summarize,
  USAGE,
  verdict,
  type GuestOutcome,
} from './load-rules.ts'

const FUNCTION_TIMEOUT_MS = 20_000
const MAX_ATTEMPTS = 5

type Step = 'join' | 'issue-upload-url' | 'put' | 'confirm-upload' | 'roll' | 'issue-view-urls' | 'view-get'
const STEPS: Step[] = ['join', 'issue-upload-url', 'put', 'confirm-upload', 'roll', 'issue-view-urls', 'view-get']

type Metric = { samples: number[]; retried: number; failed: number }
const metrics = new Map<Step, Metric>(STEPS.map((s) => [s, { samples: [], retried: 0, failed: 0 }]))
const errorsSeen = new Map<string, number>()
let bytesUp = 0
let savedShots = 0

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Answer = { status?: number; body: unknown; bytes?: number }

/** One HTTP attempt; never throws (network failures and timeouts come back without a status). */
async function attempt(url: string, init: RequestInit, timeoutMs: number, wantBytes = false): Promise<Answer> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    if (wantBytes && res.ok) return { status: res.status, body: null, bytes: (await res.arrayBuffer()).byteLength }
    const text = await res.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      // not JSON (storage answers XML); keep the text
    }
    return { status: res.status, body }
  } catch (e) {
    return { body: (e as Error).name === 'TimeoutError' ? 'timeout' : 'network' }
  }
}

function codeOf(a: Answer): string {
  const err = (a.body as { error?: { code?: unknown } } | null)?.error
  if (typeof err?.code === 'string') return err.code
  return a.status === undefined ? String(a.body) : `http_${a.status}`
}

/**
 * Call with the app's retry policy: transient failures (no answer, 5xx, 429,
 * 408, and any status in `alsoRetry`) back off and try again; anything else is
 * the final answer. Every attempt's latency and every error is recorded.
 */
async function call(
  step: Step,
  url: string,
  init: RequestInit,
  timeoutMs = FUNCTION_TIMEOUT_MS,
  opts: { alsoRetry?: number[]; expected?: number[]; wantBytes?: boolean } = {},
): Promise<Answer> {
  const m = metrics.get(step)!
  let last: Answer = { body: 'network' }
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    const t0 = performance.now()
    last = await attempt(url, init, timeoutMs, opts.wantBytes)
    m.samples.push(performance.now() - t0)
    const ok = last.status !== undefined && last.status >= 200 && last.status < 300
    // A refusal the test asked for (the extra shot) is an answer, not an error.
    if (ok || (opts.expected ?? []).includes(last.status!)) return last
    const key = `${step} ${codeOf(last)}`
    errorsSeen.set(key, (errorsSeen.get(key) ?? 0) + 1)
    const retry = isTransient(last.status) || (opts.alsoRetry ?? []).includes(last.status!)
    if (!retry || n === MAX_ATTEMPTS) break
    m.retried++
    await sleep(backoffMs(n))
  }
  m.failed++
  return last
}

const okStatus = (a: Answer) => a.status !== undefined && a.status >= 200 && a.status < 300

async function main(): Promise<number> {
  const args = parseLoadArgs(process.argv.slice(2))
  if (!args.ok) {
    console.error(args.message)
    console.error(USAGE)
    return 1
  }
  const env = readLoadEnv(process.env)
  if (!env.ok) {
    console.error(env.message)
    console.error('Local: copy .env.example to .env. Production: add SUPABASE_ANON_KEY (the public anon key) to supabase/functions/.env.production.')
    return 1
  }
  const cfg = args.value
  const { supabaseUrl, anonKey } = env.value
  const local = isLocalUrl(supabaseUrl)
  if (!local && !cfg.live) {
    console.error(`${supabaseUrl} isn't a local Supabase. This creates ${cfg.guests} test guests and their shots there.`)
    console.error('Use a TEST event (never the wedding\'s) and add --live to go ahead.')
    return 1
  }

  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' }
  const fn = (name: string, body: unknown, step: Step, opts?: { alsoRetry?: number[]; expected?: number[] }) =>
    call(step, `${supabaseUrl}/functions/v1/${name}`, { method: 'POST', headers, body: JSON.stringify(body) }, FUNCTION_TIMEOUT_MS, opts)

  // The event must exist and be open, or every join would fail for a boring reason.
  const status = await attempt(
    `${supabaseUrl}/rest/v1/rpc/event_status`,
    { method: 'POST', headers, body: JSON.stringify({ p_event_id: cfg.eventId }) },
    FUNCTION_TIMEOUT_MS,
  )
  const row = (Array.isArray(status.body) ? status.body[0] : status.body) as { is_open?: boolean } | undefined
  if (!okStatus(status)) {
    console.error(`Couldn't reach ${supabaseUrl} (${codeOf(status)}).`)
    return 1
  }
  if (!row) {
    console.error(`No event ${cfg.eventId} there.`)
    return 1
  }
  if (!row.is_open) {
    console.error('That event\'s camera isn\'t open right now. Open it from the operator console first.')
    return 1
  }

  const photoBody = new Uint8Array(cfg.photoBytes).fill(0x5a)
  photoBody.set([0xff, 0xd8, 0xff, 0xe0]) // starts like a JPEG; the rest is filler
  const clipBody = new Uint8Array(cfg.clipBytes).fill(0x3c)
  const totalBytes = cfg.guests * (PHOTOS * cfg.photoBytes + CLIPS * cfg.clipBytes)

  console.log(`Load test: ${cfg.guests} guests → ${supabaseUrl}${local ? ' (local)' : ' (LIVE)'}, event ${cfg.eventId}`)
  console.log(
    `${cfg.rampMs ? `Joining over ${formatMs(cfg.rampMs)}` : 'Everyone joins at once'}; ${PHOTOS} photos (${formatBytes(cfg.photoBytes)}) + ${CLIPS} clips (${formatBytes(cfg.clipBytes)}) each, ~${formatBytes(totalBytes)} in all.`,
  )
  if (!local) {
    console.log('Running against production in 5 s. Ctrl+C to cancel.')
    await sleep(5000)
  }

  type Shot = { id: string; type: 'photo' | 'clip' }
  const newShot = (type: Shot['type']): Shot => ({ id: crypto.randomUUID(), type })
  const bodyFor = (t: Shot['type']) => (t === 'photo' ? photoBody : clipBody)
  const contentType = (t: Shot['type']) => (t === 'photo' ? 'image/jpeg' : 'video/mp4')
  const reserve = (token: string, s: Shot, expected?: number[]) =>
    fn(
      'issue-upload-url',
      {
        deviceToken: token,
        clientShotId: s.id,
        type: s.type,
        contentType: contentType(s.type),
        size: bodyFor(s.type).byteLength,
        capturedAt: new Date().toISOString(),
      },
      'issue-upload-url',
      { expected },
    )
  const put = (uploadUrl: string, s: Shot) =>
    call(
      'put',
      uploadUrl,
      { method: 'PUT', headers: { 'Content-Type': contentType(s.type) }, body: bodyFor(s.type) },
      30_000 + Math.ceil(bodyFor(s.type).byteLength / (1024 * 1024)) * 2_000,
    )
  // 409 not_uploaded can mean storage hasn't caught up yet: the app retries it.
  const confirm = (token: string, s: Shot) =>
    fn('confirm-upload', { deviceToken: token, clientShotId: s.id }, 'confirm-upload', { alsoRetry: [409] })

  /** The app's path for one shot. True once the server has it saved. */
  async function upload(token: string, s: Shot): Promise<boolean> {
    const issued = await reserve(token, s)
    const uploadUrl = (issued.body as { uploadUrl?: string } | null)?.uploadUrl
    if (!okStatus(issued) || !uploadUrl) return false
    if (!okStatus(await put(uploadUrl, s))) return false
    bytesUp += bodyFor(s.type).byteLength
    if (!okStatus(await confirm(token, s))) return false
    savedShots++
    return true
  }

  /** The same shot sent twice at once (a retry racing its original): one shot, one allotment. */
  async function uploadTwice(token: string, s: Shot): Promise<{ saved: boolean; safe: boolean }> {
    const [a, b] = await Promise.all([reserve(token, s), reserve(token, s)])
    const idA = (a.body as { shotId?: string } | null)?.shotId
    const idB = (b.body as { shotId?: string } | null)?.shotId
    const uploadUrl = (a.body as { uploadUrl?: string } | null)?.uploadUrl
    const sameShot = okStatus(a) && okStatus(b) && !!idA && idA === idB
    if (!uploadUrl || !okStatus(a)) return { saved: false, safe: sameShot }
    if (!okStatus(await put(uploadUrl, s))) return { saved: false, safe: sameShot }
    bytesUp += bodyFor(s.type).byteLength
    const [c, d] = await Promise.all([confirm(token, s), confirm(token, s)])
    const saved = okStatus(c) || okStatus(d)
    if (saved) savedShots++
    return { saved, safe: sameShot && okStatus(c) && okStatus(d) }
  }

  // Everyone shoots at once when the last guest has joined (or failed to).
  let settled = 0
  let joinedCount = 0
  let fire!: () => void
  const burst = new Promise<void>((r) => (fire = r))
  const arrive = () => {
    if (++settled === cfg.guests) fire()
  }

  async function guest(i: number): Promise<GuestOutcome> {
    const out: GuestOutcome = {
      joined: false,
      photosSaved: 0,
      clipsSaved: 0,
      extraPhoto: null,
      extraClip: null,
      retrySafe: null,
      rollCount: null,
      rollOwnOnly: null,
      viewLinks: null,
      viewFetched: null,
    }
    await sleep(Math.random() * cfg.rampMs)
    const joined = await fn('join-event', { eventToken: cfg.eventId, firstName: `Load ${String(i + 1).padStart(3, '0')}` }, 'join')
    const token = (joined.body as { deviceToken?: string } | null)?.deviceToken
    if (!okStatus(joined) || !token) {
      arrive()
      return out
    }
    out.joined = true
    joinedCount++
    arrive()
    await burst

    const shots = [...Array.from({ length: PHOTOS }, () => newShot('photo')), ...Array.from({ length: CLIPS }, () => newShot('clip'))]
    const [first, second, ...rest] = shots
    rest.sort(() => Math.random() - 0.5)
    const saved: Shot[] = []
    const count = (s: Shot) => {
      saved.push(s)
      if (s.type === 'photo') out.photosSaved++
      else out.clipsSaved++
    }

    if (await upload(token, first)) count(first) // the burst
    await sleep(Math.random() * cfg.paceMs)
    const twice = await uploadTwice(token, second)
    out.retrySafe = twice.safe
    if (twice.saved) count(second)
    for (const s of rest) {
      await sleep(Math.random() * cfg.paceMs)
      if (await upload(token, s)) count(s)
    }

    // One more of each must be refused: the allotment is spent.
    for (const type of ['photo', 'clip'] as const) {
      const extra = await reserve(token, newShot(type), [409])
      const code = okStatus(extra) ? 'accepted' : codeOf(extra)
      if (type === 'photo') out.extraPhoto = code
      else out.extraClip = code
    }

    // My Roll: exactly this guest's shots, no one else's (RLS via the device token).
    const roll = await call('roll', `${supabaseUrl}/rest/v1/shots?select=client_shot_id,upload_status`, {
      headers: { ...headers, 'x-device-token': token },
    })
    if (okStatus(roll) && Array.isArray(roll.body)) {
      const rows = roll.body as { client_shot_id: string; upload_status: string }[]
      const mine = new Set(saved.map((s) => s.id))
      out.rollCount = rows.filter((r) => r.upload_status === 'uploaded').length
      out.rollOwnOnly = rows.every((r) => mine.has(r.client_shot_id)) && rows.length === mine.size
    }

    const views = await fn('issue-view-urls', { deviceToken: token, clientShotIds: saved.map((s) => s.id) }, 'issue-view-urls')
    const urls = (views.body as { urls?: Record<string, string> } | null)?.urls ?? {}
    out.viewLinks = Object.keys(urls).length
    const photo = saved.find((s) => s.type === 'photo')
    if (photo && urls[photo.id]) {
      const got = await call('view-get', urls[photo.id], {}, 30_000, { wantBytes: true })
      out.viewFetched = okStatus(got) && got.bytes === cfg.photoBytes
    } else {
      out.viewFetched = false
    }
    return out
  }

  const t0 = performance.now()
  const expected = cfg.guests * (PHOTOS + CLIPS)
  const progress = setInterval(() => {
    const failed = [...metrics.values()].reduce((s, m) => s + m.failed, 0)
    const retried = [...metrics.values()].reduce((s, m) => s + m.retried, 0)
    console.log(
      `  ${formatMs(performance.now() - t0).padStart(7)}  joined ${joinedCount}/${cfg.guests} · saved ${savedShots}/${expected} · ${formatBytes(bytesUp)} up · retries ${retried} · failures ${failed}`,
    )
  }, 5000)
  const outcomes = await Promise.all(Array.from({ length: cfg.guests }, (_, i) => guest(i)))
  clearInterval(progress)
  const took = performance.now() - t0

  console.log(`\nDone in ${formatMs(took)} · ${formatBytes(bytesUp)} uploaded\n`)
  console.log(`${'Step'.padEnd(18)}${'calls'.padStart(7)}${'typical'.padStart(10)}${'slow 5%'.padStart(10)}${'slowest'.padStart(10)}${'retried'.padStart(9)}${'failed'.padStart(8)}`)
  for (const step of STEPS) {
    const m = metrics.get(step)!
    const s = summarize(m.samples)
    if (!s.count) continue
    console.log(
      `${step.padEnd(18)}${String(s.count).padStart(7)}${formatMs(s.p50).padStart(10)}${formatMs(s.p95).padStart(10)}${formatMs(s.max).padStart(10)}${String(m.retried).padStart(9)}${String(m.failed).padStart(8)}`,
    )
  }
  if (errorsSeen.size) {
    console.log('\nErrors seen (retried, unless they show under "failed"):')
    for (const [k, n] of [...errorsSeen].sort((a, b) => b[1] - a[1])) console.log(`  ${k} ×${n}`)
  }

  console.log('')
  const checks = verdict(outcomes)
  for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name} (${c.detail})`)
  const pass = checks.every((c) => c.ok)
  console.log(`\n${pass ? 'PASS' : 'FAIL'}`)
  return pass ? 0 : 1
}

process.exitCode = await main()
