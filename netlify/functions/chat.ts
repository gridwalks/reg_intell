import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import Groq from 'groq-sdk'

// Derive Supabase REST URL from the DATABASE_URL provided by Netlify's Supabase integration
function getSupabaseUrl(): string {
  const dbUrl = process.env.SUPABASE_DATABASE_URL ?? ''
  const match = dbUrl.match(/postgres\.([^:@]+)[^@]*@/)
  if (match) return `https://${match[1]}.supabase.co`
  return process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
}

const supabase = createClient(getSupabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY!)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

const SYSTEM_PROMPT = `You are RegIntel, an expert pharmaceutical regulatory intelligence assistant with deep expertise in:

**Regulatory Frameworks**
- US FDA regulations (21 CFR Parts 210/211/312/314, etc.) and guidances
- EU EMA guidelines and regulations (EudraLex, Annex 1–21, etc.)
- ICH guidelines (Q1–Q14, S1–S12, E1–E20, M1–M13 series)
- PMDA, Health Canada, TGA, ANVISA, and other national/regional authorities

**Quality Systems**
- GMP, GLP, GCP, GDP, GPvP requirements
- Quality Management Systems (QMS), CAPA processes
- Validation and qualification (CSV, process validation, cleaning validation)
- Deviation management and change control

**Drug Development & Submissions**
- Common Technical Document (CTD/eCTD) format and content requirements
- NDA, BLA, ANDA, IND, CTA, MAA submission strategies
- Product lifecycle management and post-approval changes (CBE, PAS, Type IA/IB/II)
- Orphan drug designations, expedited programs (Breakthrough, Fast Track, PRIME)

**Pharmacovigilance**
- ICSRs, PSURs/PBRERs, DSURs, RMPs, REMS
- Signal detection and benefit-risk assessment
- Aggregate reporting requirements by region

**Analytical & CMC**
- Stability requirements (ICH Q1A–Q1F)
- Specifications and analytical methods
- Container closure systems, excipients

When answering:
1. Prioritize information from the provided regulatory documents over general knowledge
2. When drawing on a provided source, cite it inline using its number, e.g. [1] or [2]. Place the citation directly after the relevant sentence or clause.
3. Cite specific sections, guidance numbers, or document names when relevant
4. Clearly distinguish requirements by regulatory region/jurisdiction
5. Flag differences between regions where applicable
6. Note when guidance may have been updated and recommend verification against current versions
7. Structure complex answers with clear headings and bullet points
8. For critical regulatory decisions, recommend consultation with qualified regulatory affairs professionals

Always be precise, accurate, and practical for working regulatory professionals.`

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const token = event.headers.authorization?.replace('Bearer ', '')
  if (!token) return { statusCode: 401, body: 'Unauthorized' }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return { statusCode: 401, body: 'Unauthorized' }

  try {
    const { message, history = [] } = JSON.parse(event.body!)

    if (!message?.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing message' }) }
    }

    // 1. Embed the query
    const { data: embedData } = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: message,
    })
    const queryEmbedding = embedData[0].embedding

    // 2. Retrieve relevant chunks via pgvector similarity search (documents + newsletters in parallel)
    const [docResult, newsResult] = await Promise.all([
      supabase.rpc('match_document_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: 0.45,
        match_count: 8,
        p_user_id: user.id,
      }),
      supabase.rpc('match_newsletter_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: 0.45,
        match_count: 5,
      }),
    ])
    if (docResult.error) throw docResult.error

    const chunks = docResult.data ?? []
    const newsletterChunks = newsResult.data ?? []

    // 3. Generate signed URLs for unique documents so the UI can link to them
    type Source = {
      document_name: string
      content: string
      similarity: number
      file_url?: string
      source_type: 'document' | 'newsletter'
      newsletter_draft_id?: string
      draft_date?: string
    }
    const sources: Source[] = []

    // Fetch file_paths for unique documents referenced in chunks
    const uniqueDocIds = [...new Set(chunks.map((c: { document_id: string }) => c.document_id))]
    const docFilePaths: Record<string, string> = {}
    if (uniqueDocIds.length > 0) {
      const { data: docs } = await supabase
        .from('documents')
        .select('id, file_path, file_type')
        .in('id', uniqueDocIds)
      for (const doc of docs ?? []) {
        // Only generate signed URLs for PDFs (viewable in browser)
        if (doc.file_type === 'application/pdf' || doc.file_path?.endsWith('.pdf')) {
          const { data: signed } = await supabase.storage
            .from('regulatory-documents')
            .createSignedUrl(doc.file_path, 3600)
          if (signed?.signedUrl) docFilePaths[doc.id] = signed.signedUrl
        }
      }
    }

    let contextBlock = ''
    const contextParts: string[] = []

    if (chunks.length > 0) {
      const docContext =
        'The following excerpts are from the user\'s uploaded regulatory documents:\n\n' +
        chunks
          .map((c: { document_id: string; document_name: string; content: string; similarity: number }) => {
            sources.push({
              document_name: c.document_name,
              content: c.content.slice(0, 300),
              similarity: c.similarity,
              file_url: docFilePaths[c.document_id],
              source_type: 'document',
            })
            return `[Document: ${c.document_name} | Relevance: ${Math.round(c.similarity * 100)}%]\n${c.content}`
          })
          .join('\n\n---\n\n')
      contextParts.push(docContext)
    }

    if (newsletterChunks.length > 0) {
      const newsContext =
        'The following excerpts are from published AcceleraQA regulatory intelligence newsletters:\n\n' +
        newsletterChunks
          .map((c: { newsletter_draft_id: string; content: string; similarity: number; draft_date: string }) => {
            sources.push({
              document_name: `Newsletter — ${c.draft_date}`,
              content: c.content.slice(0, 300),
              similarity: c.similarity,
              source_type: 'newsletter',
              newsletter_draft_id: c.newsletter_draft_id,
              draft_date: c.draft_date,
            })
            return `[Newsletter: ${c.draft_date} | Relevance: ${Math.round(c.similarity * 100)}%]\n${c.content}`
          })
          .join('\n\n---\n\n')
      contextParts.push(newsContext)
    }

    // Deduplicate sources by document name (keep highest similarity)
    const deduped = Object.values(
      sources.reduce<Record<string, Source>>((acc, s) => {
        const key = s.document_name + (s.newsletter_draft_id ?? '')
        if (!acc[key] || s.similarity > acc[key].similarity) acc[key] = s
        return acc
      }, {})
    )
    sources.length = 0
    sources.push(...deduped)

    if (contextParts.length > 0) {
      // Number each source so the AI can cite them inline as [1], [2], etc.
      const numberedContext = sources
        .map((s, i) => `[${i + 1}] ${s.source_type === 'newsletter' ? 'Newsletter' : 'Document'}: ${s.document_name}\n${s.content}`)
        .join('\n\n---\n\n')
      contextBlock =
        '<regulatory_context>\nThe following sources are available. Cite them inline in your answer using [1], [2], etc. when drawing on specific content.\n\n' +
        numberedContext +
        '\n</regulatory_context>'
    }

    const userContent = contextBlock ? `${contextBlock}\n\nQuestion: ${message}` : message

    // 4. Build message history for Groq
    type ChatMsg = { role: 'user' | 'assistant'; content: string }
    const messages: ChatMsg[] = [
      ...(history as ChatMsg[]),
      { role: 'user', content: userContent },
    ]

    // 5. Call Groq
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages,
      ],
      max_tokens: 4096,
      temperature: 0.3,
    })

    const answerText = completion.choices[0]?.message?.content ?? ''

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: answerText, sources }),
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('chat error:', msg)
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}
