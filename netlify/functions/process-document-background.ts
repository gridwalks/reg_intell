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

function sanitizeText(s: string): string {
  return s
    .replace(/\x00/g, '')
    .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
    // Remove lone Unicode surrogates (U+D800–U+DFFF) that break PostgreSQL JSON
    .replace(/[\uD800-\uDFFF]/g, (ch, offset, str) => {
      const code = ch.charCodeAt(0)
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = str.charCodeAt(offset + 1)
        return (next >= 0xDC00 && next <= 0xDFFF) ? ch : ''
      }
      const prev = str.charCodeAt(offset - 1)
      return (prev >= 0xD800 && prev <= 0xDBFF) ? ch : ''
    })
}

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

    const rawText: string = doc.extracted_text ?? ''
    const text = sanitizeText(rawText)

    if (text.trim().length < 50) {
      await supabase.from('documents').update({ status: 'error', processing_error: 'Extracted text too short — PDF may be scanned or empty.' }).eq('id', document_id)
      return
    }
    console.log(`[process-document] text length=${text.length}`)

    const chunks = chunkText(text)
    console.log(`[process-document] chunks=${chunks.length}`)
    const BATCH = 10
    let stored = 0

    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH)
      console.log(`[process-document] embedding batch ${i}–${i + batch.length}`)

      const embedResp = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: batch,
      })
      console.log(`[process-document] got ${embedResp.data.length} embeddings`)

      const rows = batch.map((content, j) => ({
        document_id,
        // Sanitize each chunk as well
        content: sanitizeText(content),
        embedding: embedResp.data[j].embedding,
        chunk_index: i + j,
      }))

      console.log(`[process-document] inserting batch ${i}`)
      const { error: insertErr } = await supabase
        .from('document_chunks')
        .insert(rows)
      if (insertErr) {
        console.error(`[process-document] insert error at batch ${i}:`, JSON.stringify(insertErr))
        throw insertErr
      }
      stored += batch.length
      console.log(`[process-document] stored ${stored} chunks so far`)
    }

    await supabase
      .from('documents')
      .update({ status: 'ready', chunk_count: stored, extracted_text: null })
      .eq('id', document_id)
  } catch (err) {
    const msg = err instanceof Error
      ? err.message
      : (typeof err === 'object' && err !== null && 'message' in err)
        ? `${(err as { message: unknown }).message} | ${JSON.stringify(err)}`
        : JSON.stringify(err)
    console.error('process-document-background error:', JSON.stringify(err))
    if (document_id) {
      await supabase
        .from('documents')
        .update({ status: 'error', processing_error: msg })
        .eq('id', document_id)
    }
  }
}
