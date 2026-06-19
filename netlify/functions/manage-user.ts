import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

function getSupabaseUrl(): string {
  const dbUrl = process.env.SUPABASE_DATABASE_URL ?? ''
  const match = dbUrl.match(/postgres\.([^:@]+)[^@]*@/)
  if (match) return `https://${match[1]}.supabase.co`
  return process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
}

// Caller-facing client — uses anon key to verify the JWT
const authClient = createClient(
  getSupabaseUrl(),
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
)

// Admin client — bypasses RLS for profile writes
const adminClient = createClient(
  getSupabaseUrl(),
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Action = 'approve' | 'reject' | 'toggle_admin'

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' }

  // Verify caller JWT
  const token = event.headers.authorization?.replace('Bearer ', '')
  if (!token) return { statusCode: 401, headers, body: '{"error":"Unauthorized"}' }

  const { data: { user }, error: authErr } = await authClient.auth.getUser(token)
  if (authErr || !user) return { statusCode: 401, headers, body: '{"error":"Unauthorized"}' }

  // Confirm caller is admin
  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!callerProfile?.is_admin) {
    return { statusCode: 403, headers, body: '{"error":"Forbidden: admin only"}' }
  }

  // Parse body
  let body: { action: Action; user_id: string }
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return { statusCode: 400, headers, body: '{"error":"Invalid JSON"}' }
  }

  const { action, user_id } = body
  if (!action || !user_id) {
    return { statusCode: 400, headers, body: '{"error":"action and user_id required"}' }
  }

  // Prevent admins from removing their own admin status
  if (action === 'toggle_admin' && user_id === user.id) {
    return { statusCode: 400, headers, body: '{"error":"Cannot change your own admin status"}' }
  }

  let updatePayload: Record<string, unknown>

  switch (action) {
    case 'approve':
      updatePayload = { status: 'approved', approved_at: new Date().toISOString() }
      break
    case 'reject':
      updatePayload = { status: 'rejected' }
      break
    case 'toggle_admin': {
      const { data: target } = await adminClient
        .from('profiles')
        .select('is_admin')
        .eq('id', user_id)
        .single()
      updatePayload = { is_admin: !target?.is_admin }
      break
    }
    default:
      return { statusCode: 400, headers, body: '{"error":"Unknown action"}' }
  }

  const { error } = await adminClient
    .from('profiles')
    .update(updatePayload)
    .eq('id', user_id)

  if (error) {
    console.error('[manage-user] update error:', error.message)
    return { statusCode: 500, headers, body: `{"error":"${error.message}"}` }
  }

  return { statusCode: 200, headers, body: '{"ok":true}' }
}
