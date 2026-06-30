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

**Confidence and sourcing requirement — do not hallucinate:**
- Only state something as fact if it is supported by a numbered source [1], [2], etc. in <regulatory_context>, or by the live data in <federal_register_live_data>.
- If the <regulatory_context> block is missing, empty, or marked low-confidence for this question, you may still draw on general regulatory knowledge, but you MUST open your answer with a clearly visible flag, e.g. "⚠️ No matching source found in your uploaded documents or newsletters — this answer draws on general regulatory knowledge and should be independently verified." Do not skip this flag, and do not present general knowledge as if it came from the user's documents.
- Never invent a document name, section number, guidance number, or citation that was not explicitly given to you. If you are not certain a specific number/section exists, say so instead of guessing.
- If a question asks about something highly specific (an exact CFR subsection, a specific recent filing, a specific company/product detail) and you don't have a source for that exact detail, say plainly that you don't have a verified source for that specific point rather than approximating an answer.

CRITICAL PHARMACOVIGILANCE TERMINOLOGY:
Always distinguish between:
- SAE (Serious Adverse Event): Any untoward medical occurrence that results in death, is life-threatening, requires hospitalisation, etc. SAEs are collected by the investigator and reported to the sponsor per the protocol-defined timeline. SAEs are NOT reported directly to EudraVigilance.
- SUSAR (Suspected Unexpected Serious Adverse Reaction): An SAE that is BOTH suspected to be related to the IMP AND unexpected (not in the IB). SUSARs ARE reported to EudraVigilance.

Under EU CTR 536/2014:
- Fatal/life-threatening SUSARs: initial report within 7 calendar days of sponsor awareness; follow-up within 8 additional days (15 days total).
- Non-fatal/non-life-threatening SUSARs: 15 calendar days from sponsor awareness.
- Reporting route: EudraVigilance electronic portal (EVCTM module).
- Also notify all participating Member States via CTIS.

**FEDERAL REGISTER USAGE RULE:**
The <federal_register_live_data> block contains recent FDA notices that may cover tobacco, food, devices, cosmetics, and other non-drug topics. You MUST apply this filter before using any Federal Register item: only include it in your answer if it is directly relevant to the user's specific question (same therapeutic area, regulatory pathway, or drug/biologic topic). If no Federal Register item is relevant to the question, do not mention the Federal Register at all. Never surface tobacco, food, or device-only regulatory actions in response to a pharmaceutical/clinical trial/pharmacovigilance question.

Always be precise, accurate, and practical for working regulatory professionals.`

// HyDE: generate a short hypothetical regulatory document excerpt to improve retrieval
// Embedding the expected answer rather than the raw query bridges the gap between
// conversational language and formal legal/regulatory text in the corpus.
async function generateHypotheticalExcerpt(query: string): Promise<string> {
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content:
            'You are a pharmaceutical regulatory document generator. Write a SHORT (3–5 sentence) passage in the style of an official regulatory guidance or legislation that directly answers the following question. Use formal regulatory language with terms that would appear in EMA guidelines, ICH guidances, CFR sections, or EU regulations. Output ONLY the passage — no introduction, no commentary.',
        },
        { role: 'user', content: query },
      ],
      max_tokens: 200,
      temperature: 0.1,
    })
    return completion.choices[0]?.message?.content ?? query
  } catch {
    return query // fall back to raw query on failure
  }
}

async function fetchFdaContext(): Promise<string> {
  try {
    const base = 'https://www.federalregister.gov/api/v1'
    const fda = 'conditions[agencies][]=food-and-drug-administration'
    const docFields = 'fields[]=title&fields[]=document_number&fields[]=html_url&fields[]=type&fields[]=abstract&fields[]=publication_date'
    const today = new Date().toISOString().slice(0, 10)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    // Restrict to Rule and Proposed Rule types — excludes tobacco/food/device notices
    // that are technically FDA but irrelevant to pharma/clinical/PV queries
    const pharmaTypes = 'conditions[type][]=Rule&conditions[type][]=Proposed%20Rule&conditions[type][]=Notice'
    const [piRes, sigRes, pubRes] = await Promise.all([
      fetch(`${base}/public-inspection-documents.json?fields[]=title&fields[]=document_number&fields[]=html_url&fields[]=document_types&fields[]=abstract&per_page=10&${fda}`),
      fetch(`${base}/documents.json?per_page=10&order=newest&${docFields}&${fda}&${pharmaTypes}&conditions[significant]=1&conditions[publication_date][gte]=${weekAgo}&conditions[publication_date][lte]=${today}`),
      fetch(`${base}/documents.json?per_page=10&order=newest&${docFields}&${fda}&${pharmaTypes}&conditions[publication_date][gte]=${today}&conditions[publication_date][lte]=${today}`),
    ])

    const [piJson, sigJson, pubJson] = await Promise.all([piRes.json(), sigRes.json(), pubRes.json()])

    const fmt = (docs: Array<{ title: string; document_number: string; html_url: string; abstract?: string; type?: string; document_types?: Array<{ name: string }> }>) =>
      docs.map(d =>
        `- ${d.title} (${d.document_number}) [${d.html_url}]` +
        (d.abstract ? `\n  ${d.abstract.slice(0, 200)}…` : '')
      ).join('\n')

    const sections: string[] = []
    if (piJson.results?.length) sections.push(`FDA Documents on Public Inspection:\n${fmt(piJson.results)}`)
    if (sigJson.results?.length) sections.push(`FDA Significant Documents (past 7 days):\n${fmt(sigJson.results)}`)
    if (pubJson.results?.length) sections.push(`FDA Documents Published Today (${today}):\n${fmt(pubJson.results)}`)

    return sections.length
      ? `<federal_register_live_data>\nThe following is live data from the Federal Register as of ${today}. Use it to answer questions about recent FDA activity.\n\n${sections.join('\n\n')}\n</federal_register_live_data>`
      : ''
  } catch {
    return '' // non-fatal — degrade gracefully
  }
}

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

    // 1. Generate hypothetical excerpt (HyDE) and fetch live FR data in parallel
    const [hypotheticalExcerpt, fdaContext] = await Promise.all([
      generateHypotheticalExcerpt(message),
      fetchFdaContext(),
    ])

    // Embed the HyDE excerpt — formal regulatory language matches corpus chunks better
    // than embedding the raw conversational query
    const { data: embedData } = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: hypotheticalExcerpt,
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

    // High-confidence threshold — below this, retrieved chunks are too weak to ground an answer
    const CONFIDENCE_THRESHOLD = 0.55
    const maxSimilarity = sources.reduce((max, s) => Math.max(max, s.similarity), 0)
    const isLowConfidence = sources.length === 0 || maxSimilarity < CONFIDENCE_THRESHOLD

    if (contextParts.length > 0) {
      // Number each source so the AI can cite them inline as [1], [2], etc.
      const numberedContext = sources
        .map((s, i) => `[${i + 1}] ${s.source_type === 'newsletter' ? 'Newsletter' : 'Document'}: ${s.document_name}\n${s.content}`)
        .join('\n\n---\n\n')
      contextBlock =
        '<regulatory_context>\nThe following sources are available. Cite them inline in your answer using [1], [2], etc. when drawing on specific content.\n\n' +
        numberedContext +
        `\n</regulatory_context>\n\n<confidence_note>Best matching source similarity: ${Math.round(maxSimilarity * 100)}%. ${isLowConfidence ? 'This is BELOW the high-confidence threshold — treat this context as weak/possibly irrelevant and you MUST include the no-source-found warning unless the Federal Register live data fully answers the question.' : 'This meets the high-confidence threshold.'}</confidence_note>`
    } else {
      contextBlock =
        '<confidence_note>No matching content was found in the user\'s uploaded documents or newsletters for this question. You MUST include the no-source-found warning at the start of your answer, unless the Federal Register live data below fully answers the question.</confidence_note>'
    }

    const userContent = [contextBlock, fdaContext, `Question: ${message}`].filter(Boolean).join('\n\n')

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
      body: JSON.stringify({ message: answerText, sources, lowConfidence: isLowConfidence }),
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('chat error:', msg)
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}
