import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

function getSupabaseUrl(): string {
  const dbUrl = process.env.SUPABASE_DATABASE_URL ?? ''
  const match = dbUrl.match(/postgres\.([^:@]+)[^@]*@/)
  if (match) return `https://${match[1]}.supabase.co`
  return process.env.SUPABASE_URL ?? ''
}

const supabase = createClient(
  getSupabaseUrl(),
  process.env.SUPABASE_SERVICE_ROLE_KEY! // bypasses RLS — user verified below
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

// Chunk text with overlapping windows for better context preservation
function chunkText(text: string, chunkSize = 1200, overlap = 200): string[] {
  const chunks: string[] = []
  // Prefer splitting on paragraph breaks
  const paragraphs = text.split(/\n{2,}/)
  let current = ''

  for (const para of paragraphs) {
    if (current.length + para.length < chunkSize) {
      current += (current ? '\n\n' : '') + para
    } else {
      if (current) chunks.push(current.trim())
      // If a single paragraph is too long, split by sentences
      if (para.length > chunkSize) {
        const sentences = para.split(/(?<=[.!?])\s+/)
        let sentChunk = ''
        for (const s of sentences) {
          if (sentChunk.length + s.length < chunkSize) {
            sentChunk += (sentChunk ? ' ' : '') + s
          } else {
            if (sentChunk) chunks.push(sentChunk.trim())
            sentChunk = s
          }
        }
        current = sentChunk
      } else {
        current = para
      }
    }
  }
  if (current.trim()) chunks.push(current.trim())

  // Add overlap: prepend tail of previous chunk
  const overlapped: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      overlapped.push(chunks[i])
    } else {
      const prev = chunks[i - 1]
      const tail = prev.slice(-overlap)
      overlapped.push(tail + '\n\n' + chunks[i])
    }
  }
  return overlapped.filter(c => c.trim().length > 50)
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  // Verify the user's Supabase JWT
  const token = event.headers.authorization?.replace('Bearer ', '')
  if (!token) return { statusCode: 401, body: 'Unauthorized' }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return { statusCode: 401, body: 'Unauthorized' }

  try {
    const { document_id, text } = JSON.parse(event.body!)

    if (!document_id || !text) {
      return { statusCode: 400, body: 'Missing document_id or text' }
    }

    // Verify document belongs to user
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id')
      .eq('id', document_id)
      .eq('user_id', user.id)
      .single()

    if (docErr || !doc) {
      return { statusCode: 403, body: 'Forbidden' }
    }

    const chunks = chunkText(text)

    // Embed in batches of 20 (OpenAI rate-limit friendly)
    const BATCH = 20
    let stored = 0

    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH)

      const { data: embedData } = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: batch,
      })

      const rows = batch.map((content, j) => ({
        document_id,
        content,
        embedding: embedData[j].embedding,
        chunk_index: i + j,
      }))

      const { error: insertErr } = await supabase
        .from('document_chunks')
        .insert(rows)

      if (insertErr) throw insertErr
      stored += batch.length
    }

    // Mark document ready
    await supabase
      .from('documents')
      .update({ status: 'ready', chunk_count: stored })
      .eq('id', document_id)

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, chunks: stored }),
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('process-document error:', message)

    // Mark document as errored
    const { document_id } = JSON.parse(event.body ?? '{}')
    if (document_id) {
      await supabase
        .from('documents')
        .update({ status: 'error' })
        .eq('id', document_id)
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: message }),
    }
  }
}
