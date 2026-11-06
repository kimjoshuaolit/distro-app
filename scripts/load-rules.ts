// Pure rules for the guest load test (scripts/load-test.ts): argument parsing,
// the local-vs-live guard, latency stats and the pass/fail verdict. No I/O, so
// it's unit-tested from the client project like the other scripts' rules.

export const USAGE = `Usage:
  npm run load:test -- <eventId> [options]          (local Supabase)
  npm run load:test:prod -- <eventId> --live [opts] (production; use a TEST event)

Options:
  --guests <n>    guests to simulate (default 100, max 500)
  --ramp <s>      seconds over which guests join, like QR scans (default 30)
  --pace <ms>     longest pause between one guest's shots (default 1500)
  --photo-kb <n>  size of each photo upload in KB (default 90)
  --clip-mb <n>   size of each clip upload in MB (default 2)
  --live          required for anything that isn't a local Supabase`

/** The allotment join-event hands out (keep in step with join-event). */
export const PHOTOS = 25
export const CLIPS = 5

export type LoadArgs = {
  eventId: string
  guests: number
  rampMs: number
  paceMs: number
  photoBytes: number
  clipBytes: number
  live: boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

const NUMERIC: Record<string, { min: number; max: number }> = {
  '--guests': { min: 1, max: 500 },
  '--ramp': { min: 0, max: 600 },
  '--pace': { min: 0, max: 60_000 },
  '--photo-kb': { min: 1, max: 10 * 1024 },
  '--clip-mb': { min: 0.01, max: 50 },
}

export function parseLoadArgs(argv: string[]): Parsed<LoadArgs> {
  let eventId: string | null = null
  let live = false
  const nums: Record<string, number> = {
    '--guests': 100,
    '--ramp': 30,
    '--pace': 1500,
    '--photo-kb': 90,
    '--clip-mb': 2,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--live') {
      live = true
    } else if (arg in NUMERIC) {
      const raw = argv[++i]
      const n = Number(raw)
      const { min, max } = NUMERIC[arg]
      if (raw === undefined || !Number.isFinite(n) || n < min || n > max) {
        return { ok: false, message: `${arg} needs a number from ${min} to ${max}.` }
      }
      nums[arg] = n
    } else if (arg.startsWith('--')) {
      return { ok: false, message: `Unknown option ${arg}.` }
    } else if (eventId === null) {
      eventId = arg
    } else {
      return { ok: false, message: `Unexpected argument "${arg}".` }
    }
  }
  if (!eventId) return { ok: false, message: 'Give the event id (from the operator console).' }
  if (!UUID_RE.test(eventId)) return { ok: false, message: `"${eventId}" isn't an event id.` }
  return {
    ok: true,
    value: {
      eventId,
      guests: Math.round(nums['--guests']),
      rampMs: nums['--ramp'] * 1000,
      paceMs: nums['--pace'],
      photoBytes: Math.round(nums['--photo-kb'] * 1024),
      clipBytes: Math.round(nums['--clip-mb'] * 1024 * 1024),
      live,
    },
  }
}

export type LoadEnv = { supabaseUrl: string; anonKey: string }

/**
 * The guest-side config: only public values (the same URL and anon key the
 * app ships to every phone). SUPABASE_* wins over the app's VITE_* names.
 */
export function readLoadEnv(env: Record<string, string | undefined>): Parsed<LoadEnv> {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  const anonKey = (env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  const missing = [...(url ? [] : ['SUPABASE_URL']), ...(anonKey ? [] : ['SUPABASE_ANON_KEY'])]
  if (missing.length) return { ok: false, message: `Missing ${missing.join(' and ')}.` }
  try {
    new URL(url)
  } catch {
    return { ok: false, message: `SUPABASE_URL "${url}" isn't a URL.` }
  }
  return { ok: true, value: { supabaseUrl: url, anonKey } }
}

/** A Supabase on this machine: safe to fill with test data without asking. */
export function isLocalUrl(url: string): boolean {
  const host = new URL(url).hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
}

/** Transient failures the app's upload queue retries; everything else is final. */
export function isTransient(status: number | undefined): boolean {
  return status === undefined || status >= 500 || status === 429 || status === 408
}

/** Backoff before retry `attempt` (1-based), like the app: 1s, 2s, 4s… capped at 8s. */
export function backoffMs(attempt: number): number {
  return Math.min(8000, 1000 * 2 ** (attempt - 1))
}

export type Stats = { count: number; p50: number; p95: number; max: number }

/** Nearest-rank percentiles of latency samples (ms). */
export function summarize(samples: number[]): Stats {
  if (!samples.length) return { count: 0, p50: 0, p95: 0, max: 0 }
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]
  return { count: sorted.length, p50: rank(0.5), p95: rank(0.95), max: sorted[sorted.length - 1] }
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** What each simulated guest ended up with. */
export type GuestOutcome = {
  joined: boolean
  photosSaved: number
  clipsSaved: number
  /** Codes the server gave for the one extra photo and the one extra clip. */
  extraPhoto: string | null
  extraClip: string | null
  /** Re-sending an already-saved shot was accepted without using up another. */
  retrySafe: boolean | null
  /** Rows the guest could read back, and whether they were exactly its own. */
  rollCount: number | null
  rollOwnOnly: boolean | null
  /** View links the server signed for the guest's saved shots, and one fetched back. */
  viewLinks: number | null
  viewFetched: boolean | null
}

export type Check = { name: string; ok: boolean; detail: string }

/** The pass/fail lines of the report. Every check must hold for the run to pass. */
export function verdict(outcomes: GuestOutcome[]): Check[] {
  const n = outcomes.length
  const joined = outcomes.filter((o) => o.joined)
  const count = (pred: (o: GuestOutcome) => boolean) => joined.filter(pred).length
  const saved = joined.reduce((s, o) => s + o.photosSaved + o.clipsSaved, 0)
  const expected = joined.length * (PHOTOS + CLIPS)
  const full = count((o) => o.photosSaved === PHOTOS && o.clipsSaved === CLIPS)
  const capped = count((o) => o.extraPhoto === 'cap_reached' && o.extraClip === 'cap_reached')
  const retrySafe = count((o) => o.retrySafe === true)
  const rollOk = count((o) => o.rollCount === o.photosSaved + o.clipsSaved && o.rollOwnOnly === true)
  const viewOk = count((o) => o.viewLinks === o.photosSaved + o.clipsSaved && o.viewFetched === true)
  return [
    { name: 'Every guest joined', ok: joined.length === n, detail: `${joined.length}/${n}` },
    {
      name: `Every shot saved (${PHOTOS} photos + ${CLIPS} clips each)`,
      ok: joined.length > 0 && full === joined.length,
      detail: `${saved}/${expected} shots; ${full}/${joined.length} guests complete`,
    },
    {
      name: 'No one got more than their allotment',
      ok: joined.length > 0 && capped === joined.length,
      detail: `${capped}/${joined.length} guests refused the extra photo and clip`,
    },
    {
      name: 'A re-sent shot is not counted twice',
      ok: joined.length > 0 && retrySafe === joined.length,
      detail: `${retrySafe}/${joined.length}`,
    },
    {
      name: 'Each guest sees exactly their own roll',
      ok: joined.length > 0 && rollOk === joined.length,
      detail: `${rollOk}/${joined.length}`,
    },
    {
      name: 'Saved shots can be viewed back',
      ok: joined.length > 0 && viewOk === joined.length,
      detail: `${viewOk}/${joined.length}`,
    },
  ]
}
