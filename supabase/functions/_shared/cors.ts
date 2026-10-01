// Which browser origins may read an Edge Function's answers (go-live). Every
// function wraps its handler in withCors(); the handler's own CORS headers
// (allowed headers, methods) stay as they are, and only the allowed-origin
// header is decided here. No runtime-specific imports (unit-tested in node).
//
// ALLOWED_ORIGINS (a Function secret) is a comma-separated list, e.g.
// "https://cam.example.com,https://dispo-retro-cam.pages.dev". Unset or empty
// (local dev) keeps `*`. CORS is not authorization — every function still
// checks its own token or JWT — it stops other websites from scripting a
// visitor's browser against these endpoints.

/** An origin in comparable form: scheme://host[:port], lowercased. A pasted URL with a path keeps only its origin. */
function normalizeOrigin(raw: string): string {
  const s = raw.trim()
  if (s === '*') return '*'
  try {
    const u = new URL(s)
    if (u.origin !== 'null') return u.origin.toLowerCase()
  } catch {
    // not a URL (e.g. no scheme): compared as written, so it simply never matches
  }
  return s.replace(/\/+$/, '').toLowerCase()
}

/** "https://a.com/ , https://b.com/app" → ["https://a.com", "https://b.com"] (empty when unset). */
export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .filter((o) => o.trim() !== '')
    .map(normalizeOrigin)
}

/**
 * The Access-Control-Allow-Origin value for a request: `*` when no list is
 * configured (or it contains `*`), the request's own origin when it's listed,
 * otherwise null (no header — the browser refuses to hand the response to
 * that page).
 */
export function allowedOrigin(origin: string | null, allowList: string[]): string | null {
  if (allowList.length === 0 || allowList.includes('*')) return '*'
  if (!origin) return null
  return allowList.includes(normalizeOrigin(origin)) ? origin : null
}

type Handler = (req: Request) => Response | Promise<Response>

const readDenoEnv = (): string | undefined =>
  (globalThis as { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno?.env.get('ALLOWED_ORIGINS')

/**
 * Wrap a function's handler: whatever it answers (the OPTIONS preflight
 * included), set Access-Control-Allow-Origin per the allow-list, add
 * `Vary: Origin` when the answer depends on it, and change nothing else. A
 * handler that throws still answers a readable JSON 500 (never an opaque
 * CORS failure in the browser).
 */
export function withCors(handler: Handler, readEnv: () => string | undefined = readDenoEnv): Handler {
  return async (req: Request) => {
    let res: Response
    try {
      res = await handler(req)
    } catch (error) {
      console.error('uncaught error in function handler', { name: (error as { name?: unknown })?.name })
      res = new Response(JSON.stringify({ error: { code: 'server_error', message: 'Something went wrong.' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const allowList = parseAllowedOrigins(readEnv())
    const allow = allowedOrigin(req.headers.get('Origin'), allowList)
    const headers = new Headers(res.headers)
    headers.delete('Access-Control-Allow-Origin')
    if (allow !== null) headers.set('Access-Control-Allow-Origin', allow)
    if (allow !== '*' && !/\borigin\b/i.test(headers.get('Vary') ?? '')) headers.append('Vary', 'Origin')
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }
}
