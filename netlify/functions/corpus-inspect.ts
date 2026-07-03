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
      if (error) throw new Error(error.message ?? JSON.stringify(error))
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
        .select('id, chunk_index, page_hint, content, created_at, source_type, issuing_body, domain, geography, product_type')
        .eq('document_id', document_id)
        .order('chunk_index', { ascending: true })
      if (error) throw new Error(error.message ?? JSON.stringify(error))
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
      if (error) throw new Error(error.message ?? JSON.stringify(error))
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data ?? []),
      }
    }

    // ── Test retrieval: hybrid semantic + keyword search with HyDE ───────────
    if (body.action === 'test_retrieval') {
      const { query, match_count = 10 } = body
      if (!query?.trim()) return { statusCode: 400, body: 'Missing query' }

      // HyDE: embed a hypothetical regulatory document excerpt, not the raw query
      const hydeCompletion = await new (await import('groq-sdk')).default({
        apiKey: process.env.GROQ_API_KEY!,
      }).chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'Write a SHORT (3–5 sentence) passage in the style of an official regulatory guidance or EU regulation that directly answers the question. Use formal regulatory language. Output ONLY the passage.',
          },
          { role: 'user', content: query },
        ],
        max_tokens: 200,
        temperature: 0.1,
      })
      const hydeText = hydeCompletion.choices[0]?.message?.content ?? query

      const { data: embedData } = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: hydeText,
      })
      const embedding = embedData[0].embedding
      const { domain: filterDomain, issuing_body: filterIssuing, geography: filterGeo } = body
      const { data, error } = await supabase.rpc('hybrid_match_document_chunks', {
        query_text: query,
        query_embedding: embedding,
        match_count,
        p_user_id: null,
        ...(filterDomain   ? { p_domain: filterDomain }          : {}),
        ...(filterIssuing  ? { p_issuing_body: filterIssuing }   : {}),
        ...(filterGeo      ? { p_geography: filterGeo }          : {}),
      })
      if (error) throw new Error(error.message ?? JSON.stringify(error))

      // Normalize RRF scores relative to top result — raw values (~0.01–0.03) are meaningless as %
      const rows = (data ?? []) as Record<string, unknown>[]
      const maxScore = rows.length > 0 ? (rows[0].similarity as number) : 1
      const normalized = rows.map((r, i) => ({
        ...r,
        rrf_score: r.similarity,
        similarity: maxScore > 0 ? (r.similarity as number) / maxScore : 0,
        rank: i + 1,
        hyde_text: hydeText,
      }))

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalized),
      }
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) }
  } catch (err: unknown) {
    const msg = err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null
        ? JSON.stringify(err)
        : String(err)
    console.error('corpus-inspect error:', msg)
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}
