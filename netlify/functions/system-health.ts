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
    // Run each query independently so one failure doesn't block the rest
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
      supabase.rpc('get_db_size'),
      supabase.rpc('get_storage_size'),
      supabase.from('documents').select('status', { count: 'exact', head: false }),
      supabase.from('document_chunks').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('newsletter_drafts').select('*', { count: 'exact', head: true }).eq('status', 'published'),
      supabase.from('news_articles').select('*', { count: 'exact', head: true }),
      supabase.rpc('get_table_sizes'),
    ])

    // Log any RPC errors so they show in Netlify function logs
    if (dbSizeResult.error)      console.warn('get_db_size error:', dbSizeResult.error.message)
    if (storageSizeResult.error) console.warn('get_storage_size error:', storageSizeResult.error.message)
    if (tableStatsResult.error)  console.warn('get_table_sizes error:', tableStatsResult.error.message)

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
        db_size_bytes: dbSizeResult.data ?? null,
        storage_size_bytes: storageSizeResult.data ?? null,
        db_size_error: dbSizeResult.error?.message ?? null,
        storage_size_error: storageSizeResult.error?.message ?? null,
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
