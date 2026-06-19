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
2. Cite specific sections, guidance numbers, or document names when relevant
3. Clearly distinguish requirements by regulatory region/jurisdiction
4. Flag differences between regions where applicable
5. Note when guidance may have been updated and recommend verification against current versions
6. Structure complex answers with clear headings and bullet points
7. For critical regulatory decisions, recommend consultation with qualified regulatory affairs professionals

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

    // 2. Retrieve relevant chunks via pgvector similarity search
    const { data: chunks, error: searchErr } = await supabase.rpc(
      'match_document_chunks',
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.45,
        match_count: 10,
        p_user_id: user.id,
      }
    )
    if (searchErr) throw searchErr

    // 3. Build RAG context block
    type Source = { document_name: string; content: string; similarity: number }
    const sources: Source[] = []
    let contextBlock = ''

    if (chunks && chunks.length > 0) {
      contextBlock =
        '<regulatory_context>\nThe following excerpts are from the user\'s uploaded regulatory documents. Use these as your primary source:\n\n' +
        chunks
          .map((c: { document_name: string; content: string; similarity: number }) => {
            sources.push({
              document_name: c.document_name,
              content: c.content.slice(0, 300),
              similarity: c.similarity,
            })
            return `[Document: ${c.document_name} | Relevance: ${Math.round(c.similarity * 100)}%]\n${c.content}`
          })
          .join('\n\n---\n\n') +
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
