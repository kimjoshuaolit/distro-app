import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Fail loud in dev if .env is missing — see README "Supabase local development".
  console.warn(
    '[dispo-retro-cam] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.',
  )
}

// Couple magic links use the implicit flow on purpose (2.1): couples often ask
// for the link on a laptop and tap it on a phone, and PKCE would need the
// requesting browser's code verifier. The session arrives in the URL hash.
export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: { flowType: 'implicit', detectSessionInUrl: true },
})
