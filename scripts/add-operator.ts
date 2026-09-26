// Operator-only (Kim): put an email on the operator allow-list (Story 3.1).
//
//   npm run operator:add -- <email>          # local stack
//   npm run operator:add:prod -- <email>     # production
//
// Run once per environment. The email then signs in at /operator with a magic
// link. Real emails live only in each environment's database, never in the
// repo. Server credentials come from a gitignored env file via
// `node --env-file…` (see supabase/functions/.env.example); nothing under
// scripts/ is imported by the app.
import { createClient } from '@supabase/supabase-js'
import { OPERATOR_USAGE, parseOperatorArgs, readOperatorEnv } from './operator-rules.ts'

async function main(): Promise<number> {
  const args = parseOperatorArgs(process.argv.slice(2))
  if (!args.ok) {
    console.error(args.message)
    console.error(OPERATOR_USAGE)
    return 1
  }

  const env = readOperatorEnv(process.env)
  if (!env.ok) {
    console.error(`Missing ${env.missing.join(', ')}.`)
    console.error(
      'Set them in supabase/functions/.env (local) or supabase/functions/.env.production (prod) — see supabase/functions/.env.example.',
    )
    return 1
  }

  const db = createClient(env.value.supabaseUrl, env.value.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { error } = await db.from('operators').upsert({ email: args.email }, { onConflict: 'email', ignoreDuplicates: true })
  if (error) {
    console.error(`Couldn't add the operator: ${error.message}`)
    return 1
  }
  console.log(`${args.email} is an operator. Sign in at /operator with a magic link.`)
  return 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  },
)
