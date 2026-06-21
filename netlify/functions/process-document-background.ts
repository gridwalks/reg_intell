import type { BackgroundHandler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

function getSupabaseUrl(): string {
  // Try to derive from Netlify Supabase integration DATABASE_URL
  const dbUrl = process.env.SUPABASE_DATABASE_URL ?? ''
  const match = dbUrl.match(/postgres\.([^:@]+)[^@]*@/)
  if (match) return `https://${match[1]}.supabase.co`
  // Fall back to the manually-added VITE_ var (accessible in functions at runtime)
  return process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
}

const supabase = createClient(
  getSupabaseUrl(),
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

function chunkText(text: string, chunkSize = 1200, overlap = 200): string[] {
  const chunks: string[] = []
  const paragraphs = text.split(/\n{2,}/)
  let current = ''

  for (const para of paragraphs) {
    if (current.length + para.length < chunkSize) {
      current += (current ? '\n\n' : '') + para
    } else {
      if (current) chunks.push(current.trim())
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

  const overlapped: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      overlapped.push(chunks[i])
    } else {
      const tail = chunks[i - 1].slice(-overlap)
      overlapped.push(tail + '\n\n' + chunks[i])
    }
  }
  return overlapped.filter(c => c.trim().length > 50)
}

export const handler: BackgroundHandler = async (event) => {
  const supabaseUrl = getSupabaseUrl()
  console.log('[process-document-background] supabase url:', supabaseUrl || 'EMPTY — check env vars')

  const token = event.headers.authorization?.replace('Bearer ', '')
  if (!token) { console.log('[process-document-background] no token'); return }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) { console.log('[process-document-background] auth failed:', authError?.message); return }

  let document_id: string | undefined
  try {
    const body = JSON.parse(event.body!)
    document_id = body.document_id

    if (!document_id) return

    // Fetch document + extracted text from DB (avoids POST body size limits)
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, extracted_text')
      .eq('id', document_id)
      .eq('user_id', user.id)
      .single()
    if (docErr || !doc) return

    const text: string = doc.extracted_text ?? ''
    if (text.trim().length < 50) {
      await supabase.from('documents').update({ status: 'error', processing_error: 'Extracted text too short — PDF may be scanned or empty.' }).eq('id', document_id)
      return
    }

    const chunks = chunkText(text)
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

    await supabase
      .from('documents')
      .update({ status: 'ready', chunk_count: stored, extracted_text: null })
      .eq('id', document_id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('process-document-background error:', msg)
    if (document_id) {
      await supabase
        .from('documents')
        .update({ status: 'error', processing_error: msg })
        .eq('id', document_id)
    }
  }
}
