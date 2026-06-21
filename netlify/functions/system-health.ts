import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

function getSupabaseUrl(): string {
  const dbUrl = process.env.SUPABASE_DATABASE_URL ?? ''
  const match = dbUrl.match(/postgres\.([^:@]+)[^@]*@/)
  if (match) return `https://${match[1]}.supabase.co`
  return process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
}

const supabase = createClient(getSupabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY!)

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' }

  const token = event.headers.authorization?.replace('Bearer ', '')
  if (!token) return { statusCode: 401, body: 'Unauthorized' }

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return { statusCode: 401, body: 'Unauthorized' }

  // Verify admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return { statusCode: 403, body: 'Forbidden' }

  try {
    const [
      dbSizeResult,
      storageSizeResult,
      docCount,
      chunkCount,
      userCount,
      pendingUsers,
      newsletterCount,
      newsArticleCount,
      tableStatsResult,
    ] = await Promise.all([
      // Database size
      supabase.rpc('get_db_size'),
      // Storage bucket size
      supabase.rpc('get_storage_size'),
      // Document count + status breakdown
      supabase.from('documents').select('status', { count: 'exact', head: false }),
      // Chunk count
      supabase.from('document_chunks').select('*', { count: 'exact', head: true }),
      // Total users
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      // Pending approvals
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      // Published newsletters
      supabase.from('newsletter_drafts').select('*', { count: 'exact', head: true }).eq('status', 'published'),
      // News articles ingested
      supabase.from('news_articles').select('*', { count: 'exact', head: true }),
      // Per-table sizes
      supabase.rpc('get_table_sizes'),
    ])

    // Tally document statuses
    const docs = docCount.data ?? []
    const docStats = {
      total: docs.length,
      ready: docs.filter((d: { status: string }) => d.status === 'ready').length,
      processing: docs.filter((d: { status: string }) => d.status === 'processing').length,
      error: docs.filter((d: { status: string }) => d.status === 'error').length,
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        db_size_bytes: dbSizeResult.data ?? 0,
        storage_size_bytes: storageSizeResult.data ?? 0,
        documents: docStats,
        chunk_count: chunkCount.count ?? 0,
        user_count: userCount.count ?? 0,
        pending_users: pendingUsers.count ?? 0,
        newsletter_count: newsletterCount.count ?? 0,
        news_article_count: newsArticleCount.count ?? 0,
        table_sizes: tableStatsResult.data ?? [],
        fetched_at: new Date().toISOString(),
      }),
    }
  } catch (err) {
    console.error('system-health error:', err)
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to fetch metrics' }) }
  }
}
