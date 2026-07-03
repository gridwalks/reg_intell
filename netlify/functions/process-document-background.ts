import type { BackgroundHandler } from '@netlify/functions'
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

// ── Text sanitization ──────────────────────────────────────────────────────────
function sanitizeText(s: string): string {
  return s
    .replace(/\x00/g, '')
    .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
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

// ── Section-aware chunking (~400 tokens / ~1600 chars, 10% overlap) ─────────
// Splits on regulatory section headers first, then by paragraph within each section.
// Headers detected: "Article 49", "Section 4.3", "Annex I", "4.2.1 Title", etc.
const SECTION_HEADER_RE = /^(?:article|section|annex|chapter|part|appendix|schedule)\s+[\divxlcdm]+(?:\.\d+)*(?:\s+\S.*)?$|^\d+(?:\.\d+)+(?:\s+\S.*)?$/im

function splitIntoSections(text: string): string[] {
  const lines = text.split('\n')
  const sections: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (SECTION_HEADER_RE.test(line.trim()) && current.join('').trim().length > 80) {
      sections.push(current.join('\n'))
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.join('').trim()) sections.push(current.join('\n'))
  return sections.filter(s => s.trim().length > 0)
}

function chunkSection(text: string, maxChars = 1600, overlapChars = 160): string[] {
  const paragraphs = text.split(/\n{2,}/)
  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    if (current.length + para.length < maxChars) {
      current += (current ? '\n\n' : '') + para
    } else {
      if (current) chunks.push(current.trim())
      if (para.length > maxChars) {
        // Sentence-level fallback for very long paragraphs
        const sentences = para.split(/(?<=[.!?])\s+/)
        let sentChunk = ''
        for (const s of sentences) {
          if (sentChunk.length + s.length < maxChars) {
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

  // Add trailing overlap from previous chunk
  const overlapped: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      overlapped.push(chunks[i])
    } else {
      const tail = chunks[i - 1].slice(-overlapChars)
      overlapped.push(tail + '\n\n' + chunks[i])
    }
  }
  return overlapped.filter(c => c.trim().length > 50)
}

function chunkText(text: string): string[] {
  const sections = splitIntoSections(text)
  const all: string[] = []
  for (const section of sections) {
    all.push(...chunkSection(section))
  }
  return all
}

// ── Auto-metadata inference from document name ────────────────────────────────
interface ChunkMetadata {
  source_type: string
  issuing_body: string
  product_type: string[]
  geography: string[]
  domain: string[]
}

function inferMetadata(docName: string): ChunkMetadata {
  const n = docName.toUpperCase()

  // issuing_body
  let issuing_body = 'unknown'
  if (/\bICH\b/.test(n)) issuing_body = 'ICH'
  else if (/\bEMA\b|\bEMEA\b|EudraLex|CHMP|CPMP|EMRN/.test(n)) issuing_body = 'EMA'
  else if (/\bFDA\b|CFR\b|CDER|CBER|CDRH|21\s*CFR/.test(n)) issuing_body = 'FDA'
  else if (/\bWHO\b/.test(n)) issuing_body = 'WHO'
  else if (/\bPIC.?S\b/.test(n)) issuing_body = 'PIC/S'
  else if (/\bEC\b|EUROPEAN COMMISSION/.test(n)) issuing_body = 'EC'
  else if (/MHRA/.test(n)) issuing_body = 'MHRA'

  // domain[]
  const domain: string[] = []
  if (/\bGMP\b|GMP\s*ANNEX|CLEANROOM|EudraLex.*VOL.?4/.test(n)) domain.push('GMP')
  if (/\bGCP\b|ICH\s*E\d|CLINICAL\s*TRIAL|CTR\b/.test(n)) domain.push('GCP')
  if (/\bGVP\b|PHARMACOVIGILANCE|ADVERSE\s*REACTION|PSUR|PBRER|SUSAR|CIOMS/.test(n)) domain.push('pharmacovigilance')
  if (/\bCMC\b|CHEMISTRY|MANUFACTURING|CONTROL/.test(n)) domain.push('CMC')
  if (/REGISTRATION|MAA\b|NDA\b|BLA\b|VARIATION|DOSSIER/.test(n)) domain.push('registration')
  if (/CLINICAL|PHASE [123]|TRIAL/.test(n)) {
    if (!domain.includes('GCP')) domain.push('clinical')
  }
  if (domain.length === 0) domain.push('general')

  // source_type
  let source_type = 'guideline'
  if (/REGULATION\b|\bREG\b|\bEC\s+\d{3,}|\bEU\s+\d{3,}|\b21\s*CFR/.test(n)) source_type = 'regulation'
  else if (/GUIDANCE\b/.test(n)) source_type = 'guidance'
  else if (/Q&A|QUESTION/.test(n)) source_type = 'Q&A'
  else if (/NEWSLETTER|BULLETIN/.test(n)) source_type = 'newsletter'

  // geography[]
  const geography: string[] = []
  if (/\bEU\b|EMA\b|EMEA\b|EUROPEAN|EudraLex|EC\s+\d/.test(n)) geography.push('EU')
  if (/\bUS\b|FDA\b|CFR\b|CDER|CBER/.test(n)) geography.push('US')
  if (/\bICH\b|WHO\b|GLOBAL|INTERNATIONAL/.test(n)) geography.push('global')
  if (/\bUK\b|MHRA\b/.test(n)) geography.push('UK')
  if (geography.length === 0) geography.push('global')

  // product_type (default drug unless specifically device/biologic/etc.)
  const product_type: string[] = ['drug']
  if (/BIOLOGIC|BIOLOGICS|BIOTECH|BIOSIMILAR/.test(n)) product_type.push('biologic')
  if (/DEVICE|MDR\b|IVDR\b/.test(n)) {
    product_type.length = 0
    product_type.push('device')
  }

  return { source_type, issuing_body, product_type, geography, domain }
}

// ── Background handler ────────────────────────────────────────────────────────
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

    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, name, extracted_text')
      .eq('id', document_id)
      .eq('user_id', user.id)
      .single()
    if (docErr || !doc) return

    const rawText: string = doc.extracted_text ?? ''
    const text = sanitizeText(rawText)

    if (text.trim().length < 50) {
      await supabase.from('documents').update({
        status: 'error',
        processing_error: 'Extracted text too short — PDF may be scanned or empty.',
      }).eq('id', document_id)
      return
    }

    const metadata = inferMetadata(doc.name ?? '')
    console.log(`[process-document] doc="${doc.name}" meta=${JSON.stringify(metadata)} text=${text.length}`)

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

      const rows = batch.map((content, j) => ({
        document_id,
        content: sanitizeText(content),
        embedding: embedResp.data[j].embedding,
        chunk_index: i + j,
        source_type: metadata.source_type,
        issuing_body: metadata.issuing_body,
        product_type: metadata.product_type,
        geography: metadata.geography,
        domain: metadata.domain,
      }))

      const { error: insertErr } = await supabase.from('document_chunks').insert(rows)
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
    console.error('process-document-background error:', msg)
    if (document_id) {
      await supabase
        .from('documents')
        .update({ status: 'error', processing_error: msg })
        .eq('id', document_id)
    }
  }
}
