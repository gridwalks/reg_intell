// Build wrapper: maps Netlify Supabase integration env vars → VITE_ prefixed vars
// SUPABASE_DATABASE_URL format: postgresql://postgres.[ref]:[pass]@...pooler.supabase.com:.../postgres
const { execSync } = require('child_process')

const dbUrl = process.env.SUPABASE_DATABASE_URL || ''
const match = dbUrl.match(/postgres\.([^:@]+)[^@]*@/)
if (match) {
  const projectRef = match[1]
  process.env.VITE_SUPABASE_URL = `https://${projectRef}.supabase.co`
  console.log(`[build] Derived VITE_SUPABASE_URL: https://${projectRef}.supabase.co`)
} else if (!process.env.VITE_SUPABASE_URL) {
  console.warn('[build] Warning: could not derive VITE_SUPABASE_URL from SUPABASE_DATABASE_URL')
}

if (!process.env.VITE_SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY) {
  process.env.VITE_SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  console.log('[build] Mapped SUPABASE_ANON_KEY → VITE_SUPABASE_ANON_KEY')
}

execSync('tsc && vite build', { stdio: 'inherit', env: process.env })
