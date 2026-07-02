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
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }

  const token = event.headers.authorization?.replace('Bearer ', '')
  if (!token) return { statusCode: 401, body: 'Unauthorized' }

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return { statusCode: 401, body: 'Unauthorized' }

  const { data: profile } = await supabase
    .from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { statusCode: 403, body: 'Forbidden' }

  try {
    const { name, text, source_note } = JSON.parse(event.body ?? '{}')
    if (!name?.trim() || !text?.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'name and text are required' }) }
    }

    const fullText = source_note
      ? `[Source: ${source_note}]\n\n${text}`
      : text

    // Create a synthetic document row — no file in storage
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .insert({
        user_id: user.id,
        name: name.trim(),
        file_path: `synthetic/${user.id}/${Date.now()}_${name.trim().replace(/[^\w]/g, '_')}.txt`,
        file_size: fullText.length,
        file_type: 'text/plain',
        status: 'processing',
        extracted_text: fullText,
      })
      .select('id')
      .single()

    if (docErr) throw new Error(docErr.message)

    // Trigger background embedder — same path as PDF ingestion
    const bgUrl = process.env.URL
      ? `${process.env.URL}/.netlify/functions/process-document-background`
      : null

    if (bgUrl) {
      await fetch(bgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: doc.id }),
      }).catch(() => null) // fire-and-forget
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_id: doc.id, message: 'Ingestion started' }),
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('ingest-text error:', msg)
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}
