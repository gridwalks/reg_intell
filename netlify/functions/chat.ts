import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

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
    const { query, conversation_history = [] } = JSON.parse(event.body!)

    if (!query?.trim()) {
      return { statusCode: 400, body: 'Missing query' }
    }

    // 1. Embed the query
    const { data: embedData } = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
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
    let contextBlock = ''
    const sources: Array<{ doc_name: string; snippet: string; similarity: number }> = []

    if (chunks && chunks.length > 0) {
      contextBlock =
        '<regulatory_context>\nThe following excerpts are from the user\'s uploaded regulatory documents. Use these as your primary source:\n\n' +
        chunks
          .map(
            (c: { doc_name: string; content: string; similarity: number }, i: number) => {
              sources.push({
                doc_name: c.doc_name,
                snippet: c.content.slice(0, 300),
                similarity: Math.round(c.similarity * 100),
              })
              return `[Document: ${c.doc_name} | Relevance: ${Math.round(c.similarity * 100)}%]\n${c.content}`
            }
          )
          .join('\n\n---\n\n') +
        '\n</regulatory_context>'
    }

    // 4. Compose messages for Claude
    const userContent = contextBlock
      ? `${contextBlock}\n\nQuestion: ${query}`
      : query

    type ConvTurn = { role: 'user' | 'assistant'; content: string }
    const messages: Anthropic.MessageParam[] = [
      ...(conversation_history as ConvTurn[]).map(
        (m): Anthropic.MessageParam => ({ role: m.role, content: m.content })
      ),
      { role: 'user', content: userContent },
    ]

    // 5. Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages,
    })

    const answerText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: answerText,
        sources,
        stop_reason: response.stop_reason,
      }),
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('chat error:', message)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: message }),
    }
  }
}
