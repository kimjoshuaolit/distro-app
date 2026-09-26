// Pure helpers for scripts/add-operator.ts (Story 3.1), unit-tested. No I/O.

export const OPERATOR_USAGE = 'Usage: npm run operator:add -- <email>'

// Deliberately loose (Auth has the final say): one @, no spaces, a dot in the domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type OperatorArgs = { ok: true; email: string } | { ok: false; message: string }

/** Exactly one argument: the operator's email, normalized (lowercased, trimmed). */
export function parseOperatorArgs(argv: string[]): OperatorArgs {
  if (argv.length !== 1) return { ok: false, message: 'Give exactly one email.' }
  const email = argv[0].trim().toLowerCase()
  if (email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, message: `"${argv[0]}" isn't an email address.` }
  return { ok: true, email }
}

export const OPERATOR_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const

export type OperatorEnv =
  | { ok: true; value: { supabaseUrl: string; serviceRoleKey: string } }
  | { ok: false; missing: string[] }

/** The server credentials the script needs; names only are ever reported. */
export function readOperatorEnv(env: Record<string, string | undefined>): OperatorEnv {
  const get = (name: string) => env[name]?.trim() ?? ''
  const missing = OPERATOR_ENV.filter((name) => get(name) === '')
  if (missing.length > 0) return { ok: false, missing }
  return { ok: true, value: { supabaseUrl: get('SUPABASE_URL'), serviceRoleKey: get('SUPABASE_SERVICE_ROLE_KEY') } }
}
