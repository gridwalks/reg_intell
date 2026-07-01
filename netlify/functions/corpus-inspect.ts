import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

function getSupabaseUrl(): string {
  const dbUrl = process.env.SUPABASE_DATABASE_URL ?? ''
  const match = dbUrl.match(/postgres\.([^:@]+)[^@]*@/)
  if (match) return `https://${match[1]}.supabase.co`
  return process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
}

const supabase = createClient(getSupabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY!)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }

  const token = event.headers.authorization?.replace('Bearer ', '')
  if (!token) return { statusCode: 401, body: 'Unauthorized' }

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return { statusCode: 401, body: 'Unauthorized' }

  // Verify admin
  const { data: profile } = await supabase
    .from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { statusCode: 403, body: 'Forbidden' }

  const body = JSON.parse(event.body ?? '{}')

  try {
    // ── List all documents with chunk counts ──────────────────────────────────
    if (body.action === 'list_documents') {
      const { data, error } = await supabase
        .from('documents')
        .select('id, name, status, chunk_count, file_size, file_type, created_at, updated_at, processing_error, user_id')
        .order('created_at', { ascending: false })
      if (error) throw error
      // Attach owner emails
      const userIds = [...new Set((data ?? []).map((d: { user_id: string }) => d.user_id))]
      const { data: profiles } = await supabase
        .from('profiles').select('id, email').in('id', userIds)
      const emailMap = Object.fromEntries((profiles ?? []).map((p: { id: string; email: string }) => [p.id, p.email]))
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify((data ?? []).map((d: Record<string, unknown>) => ({ ...d, owner_email: emailMap[d.user_id as string] ?? d.user_id }))),
      }
    }

    // ── List chunks for a document ────────────────────────────────────────────
    if (body.action === 'list_chunks') {
      const { document_id } = body
      if (!document_id) return { statusCode: 400, body: 'Missing document_id' }
      const { data, error } = await supabase
        .from('document_chunks')
        .select('id, chunk_index, page_hint, content, created_at')
        .eq('document_id', document_id)
        .order('chunk_index', { ascending: true })
      if (error) throw error
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data ?? []),
      }
    }

    // ── Full-text search across all chunk content ─────────────────────────────
    if (body.action === 'search_chunks') {
      const { query } = body
      if (!query?.trim()) return { statusCode: 400, body: 'Missing query' }
      const { data, error } = await supabase
        .from('document_chunks')
        .select('id, chunk_index, page_hint, content, document_id, documents!inner(name, status)')
        .ilike('content', `%${query.trim()}%`)
        .limit(50)
      if (error) throw error
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data ?? []),
      }
    }

    // ── Test retrieval: embed query, run similarity search ────────────────────
    if (body.action === 'test_retrieval') {
      const { query, match_count = 10 } = body
      if (!query?.trim()) return { statusCode: 400, body: 'Missing query' }
      const { data: embedData } = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: query,
      })
      const embedding = embedData[0].embedding
      const { data, error } = await supabase.rpc('admin_match_document_chunks', {
        query_embedding: embedding,
        match_count,
      })
      if (error) throw error
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data ?? []),
      }
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('corpus-inspect error:', msg)
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}
