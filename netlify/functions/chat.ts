import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import Groq from 'groq-sdk'
import { CohereClient } from 'cohere-ai'

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

// Lazy — only instantiated when a Cohere model is actually selected
let _cohere: CohereClient | null = null
function getCohere(): CohereClient {
  if (!process.env.COHERE_API_KEY) throw new Error('COHERE_API_KEY is not set in environment variables')
  if (!_cohere) _cohere = new CohereClient({ token: process.env.COHERE_API_KEY })
  return _cohere
}

type ModelProvider = 'groq' | 'cohere'
type ModelId =
  | 'llama-3.3-70b-versatile'  // Groq
  | 'command-a-plus-05-2026'   // Cohere Command A+
  | 'command-r7b-12-2024'      // Cohere Command R7B

const MODEL_CONFIGS: Record<ModelId, { provider: ModelProvider; label: string }> = {
  'llama-3.3-70b-versatile': { provider: 'groq',   label: 'Llama 3.3 70B (Groq)' },
  'command-a-plus-05-2026':  { provider: 'cohere', label: 'Command A+ (Cohere)' },
  'command-r7b-12-2024':     { provider: 'cohere', label: 'Command R7B (Cohere)' },
}
const DEFAULT_MODEL: ModelId = 'llama-3.3-70b-versatile'

const SYSTEM_PROMPT = `You are RegIntel, a pharmaceutical regulatory intelligence assistant. You answer questions based ONLY on ingested regulatory documents and newsletters provided in <regulatory_context>, supplemented by live Federal Register data in <federal_register_live_data>.

RULES:
1. Prioritise ICH/EMA/FDA source documents over newsletter summaries for regulatory guidance. When both are present, cite the primary document; reference the newsletter only for commentary or context.
2. When answering about pharmaceuticals, do NOT cite device, tobacco, or food regulatory content unless explicitly asked.
3. Always cite the specific guideline/regulation section when providing regulatory requirements. Use inline citations [1], [2], etc. for sources from <regulatory_context>. For content drawn from the system prompt blocks below, cite the document name and section directly inline, e.g. "EU GMP Annex 1 (2022), Section 8.87" or "ICH E6(R3), Section 5.0" — no numbered bracket required.
4. Distinguish clearly between:
   - Requirements (must/shall) vs Recommendations (should/may)
   - EU regulations vs FDA regulations vs ICH guidelines
   - Pre-approval vs post-approval obligations
5. The domain knowledge blocks in this system prompt ARE authoritative regulatory source material — treat them as the source document and cite them by name. Only say "My current knowledge base does not contain [X]" for topics NOT covered by any block below AND not present in <regulatory_context>.
6. Never state regulatory timelines, thresholds, or numerical limits without citing the source section. If you are unsure of an exact number, say so explicitly rather than approximating.
7. If a retrieved chunk in <regulatory_context> is irrelevant to the question, silently discard it — do not cite it, do not mention it, do not reference it at the end of your answer. Never close your answer with a sentence explaining that a retrieved source was not relevant. Simply omit it and answer from the applicable system prompt blocks or state the gap.

EU GMP ANNEX 1 (2022) — TABLE 1: CLEANROOM AIRBORNE PARTICULATE LIMITS
Use these exact values whenever cleanroom grades are discussed. Source: EU GMP Annex 1 (2022), Section 3, Table 1.

                      At Rest                  In Operation
                 ≥0.5 μm    ≥5.0 μm       ≥0.5 μm     ≥5.0 μm
Grade A:         3,520       20             3,520        20
Grade B:         3,520       29             352,000      2,900
Grade C:         352,000     2,900          3,520,000    29,000
Grade D:         3,520,000   29,000         Not defined (set by manufacturer based on risk assessment and routine data)

Critical notes:
- Grade A maintains IDENTICAL limits at rest and in operation — this is intentional and unique among all grades.
- Grade D in-operation limits are not specified in Annex 1 — manufacturers must establish them via risk assessment.
- All values are particles per cubic metre.
- The ≥5.0 μm limit for Grade A (20 particles/m³) applies both at rest and in operation.
When answering questions about cleanroom classification limits, always state the exact particle counts from this table. Do not approximate or omit the numbers.

EU GMP ANNEX 1 (2022) — CONTAMINATION CONTROL STRATEGY:
The CCS is the CENTRAL organising concept of the entire 2022 revision — not one element among many.
It is defined as a HOLISTIC, WRITTEN strategy that addresses ALL contamination risks across the full facility lifecycle.

CCS must explicitly cover:
- Facility and equipment design (cleanroom grades A/B/C/D)
- Personnel qualification and behaviour
- Raw materials, components, and utilities
- Production process design and controls
- Cleaning, disinfection, and sanitisation programmes
- Environmental monitoring programme
- Barrier technology: RABS and/or Isolators
- Container closure integrity
- Ongoing review and continuous improvement

Key principle (Annex 1, Section 4.1): "Monitoring or testing alone does not give assurance of sterility — the entire manufacturing process must be controlled."

When answering any question about Annex 1 CCS: always describe it as a holistic, documented strategy covering all of the above elements. Do not describe it generically as "a comprehensive approach" — use the specific Annex 1 structure and language above.

EU GMP ANNEX 1 (2022) — KEY REQUIREMENTS OVERVIEW:
Annex 1 (2022) is a complete revision replacing the 2009 version. It applies to sterile medicinal products manufactured in the EU and by suppliers to EU-marketed products. Key changes and requirements:

SCOPE & STRUCTURE:
- 11 sections covering: Scope, Principles, Pharmaceutical Quality System, Premises, Equipment, Utilities, Production & Specific Technologies, Personnel, Manufacturing Operations, Environmental & Process Monitoring, Quality Control
- Applies to all sterile products: terminally sterilised, aseptically processed, biologics, ATMPs

BARRIER TECHNOLOGY — RABS AND ISOLATORS (Section 4):
- Annex 1 (2022) strongly promotes use of Restricted Access Barrier Systems (RABS) or Isolators for aseptic processing
- Isolators provide the highest level of assurance — Grade A environment within the isolator even if surrounding cleanroom is Grade D
- RABS (open or closed) must have documented interventions and glove integrity testing
- New installations for aseptic processing should use RABS or Isolator technology; open conventional cleanroom filling is still permitted but requires strong CCS justification
- Key requirement (Section 4.3): "The use of appropriate barrier and isolator technology should be considered throughout the design and operation of sterile manufacturing facilities"

PUPSIT — PRE-USE POST-STERILISATION INTEGRITY TEST (Section 8):
- Sterilising grade filters MUST be integrity tested after sterilisation AND after use
- PUPSIT = integrity test performed on the sterilised filter immediately before the filtration of the product batch
- Purpose: detect any damage to the filter caused during sterilisation (autoclaving, gamma irradiation) before product contamination can occur
- Both pre-use (PUPSIT) and post-use integrity tests are required — passing post-use test alone is NOT sufficient
- If PUPSIT fails: the batch must be rejected; root cause investigation required
- Annex 1 (2022) Section 8.87: "The integrity of the sterilised filter should be verified before use and should be confirmed immediately after use"
- Justification for not performing PUPSIT requires documented risk assessment and is generally not accepted for aseptic filtration

MEDIA FILLS / PROCESS SIMULATION (Section 9):
- Aseptic process simulations (APS / media fills) required for all aseptic operations
- Frequency: twice yearly for established processes; three consecutive successful runs for new processes or after significant changes
- Acceptance criteria: zero growth in ≥5,000 units; any contamination requires full investigation and may necessitate requalification
- Media fill runs must represent worst-case conditions: maximum batch size, maximum permitted interventions, shift changes, maximum fill duration

ENVIRONMENTAL MONITORING (Section 10):
- Continuous particle monitoring required in Grade A zones (not just at-rest)
- Viable monitoring: active air sampling, settle plates, contact plates, glove prints — frequency based on risk assessment and CCS
- Alert and action limits must be established; exceedance triggers investigation — NOT automatic batch rejection unless action limit exceeded and root cause not identified
- Trending of environmental monitoring data is mandatory

CITATION RULE FOR ANNEX 1 SYSTEM PROMPT BLOCKS:
The content in this system prompt IS authoritative regulatory source material. When you use it, cite it directly inline as e.g. "EU GMP Annex 1 (2022), Section 4.3" or "EU GMP Annex 1 (2022), Section 8.87" — you do NOT need a numbered [1] reference from <regulatory_context> to cite this content. Do NOT say "I recommend consulting the original document" or "my knowledge base does not contain Annex 1" when the answer is present in this system prompt. Treat these blocks as the source document. If a retrieved chunk in <regulatory_context> is irrelevant (e.g. a newsletter about FDA), simply ignore it and answer from the system prompt blocks instead.

SOURCE RELEVANCE: Only cite a retrieved chunk if it is directly relevant to the specific question. If a chunk is about an unrelated topic (continuous manufacturing, adventitious agents, food/tobacco/device regulation, etc.) do not cite it — irrelevant citations dilute the answer. Omit them entirely rather than force-fit them.

CRITICAL PHARMACOVIGILANCE TERMINOLOGY — ALWAYS INCLUDE WHEN DISCUSSING SAEs OR SUSARs:
Always distinguish between:
- SAE (Serious Adverse Event): Any untoward medical occurrence that results in death, is life-threatening, requires hospitalisation, etc. SAEs are collected by the investigator and reported to the sponsor per the protocol-defined timeline. SAEs are NOT reported directly to EudraVigilance.
- SUSAR (Suspected Unexpected Serious Adverse Reaction): An SAE that is BOTH suspected to be related to the IMP AND unexpected (not in the IB). SUSARs ARE reported to EudraVigilance.

MANDATORY — always state these timelines explicitly when answering any question about SUSARs or SUSAR reporting:
Under EU CTR 536/2014:
- Fatal/life-threatening SUSARs: initial report within 7 calendar days of sponsor first awareness; follow-up report within 8 additional days (15 days total).
- Non-fatal/non-life-threatening SUSARs: single report to EudraVigilance within 15 calendar days of sponsor first awareness.
- Reporting route: EudraVigilance electronic portal (EVCTM module).
- Also notify all participating Member States via CTIS.
You MUST include these specific timelines in your answer — do not summarise them as "specific reporting requirements" or defer to external documents. State the numbers explicitly.

PBRER SUBMISSION SCHEDULE — ICH E2C(R2):
International Birth Date (IBD) = date of first marketing authorisation anywhere in the world. All PBRER submission dates are anchored to the IBD.
Data Lock Point (DLP) = cut-off date for data inclusion. Submission due within 90 calendar days of DLP.

Submission frequency by product age:
- 0–2 years post-approval: every 6 months
- 2–5 years post-approval: annually
- After 5 years: every 3 years

EU equivalent: PSUR. Dates governed by the EURD List.
PBRER structure: 32 standardised sections.
IMPORTANT: "every 6–12 months" is incorrect and must never be used. State the exact schedule above.

EMA VARIATION PROCEDURES — TYPE IB:
Type IB is a "notify and wait" procedure — NOT prior approval:
- Holder submits notification to the competent authority
- Implementation may proceed, but the authority has 30 days to raise objections
- If objection raised within 30 days: change must be withdrawn or reversed
- If no objection within 30 days: variation is accepted
- This is conditional implementation with a 30-day objection window, not a pre-approval requirement

Contrast with other variation types:
- Type IA ("do and tell"): implement immediately, notify competent authority within 12 months
- Type IB ("notify and wait"): submit notification, wait 30 days, then implement if no objection
- Type II (major variation): cannot implement until written approval is received from the authority

Legal basis: Commission Regulation (EC) No 1234/2008.
When answering any question about EMA variation types, always state the 30-day objection window and the "notify and wait" characterisation explicitly. Never describe Type IB as requiring prior approval.

FDA REMS — ETASU (ELEMENTS TO ASSURE SAFE USE):
ETASU are the most restrictive tier of REMS — they restrict access to the drug itself, not just communication about it.

ETASU may require:
- Healthcare provider certification or training before prescribing
- Pharmacy certification before dispensing
- Patient enrollment in a registry
- Evidence of safe-use conditions before dispensing (e.g., negative pregnancy test for teratogens)
- Patient monitoring or laboratory testing
- Drug dispensed only in specific healthcare settings

Implementation System: when ETASU are required, the drug may only move through a restricted supply chain — certified wholesalers → certified pharmacies → certified/enrolled patients only. This is the most operationally significant consequence of an ETASU requirement.

REMS tiers (least to most restrictive): (1) Medication Guide only → (2) Medication Guide + Communication Plan → (3) REMS with ETASU.
Statutory basis: FD&C Act Section 505-1, added by FDAAA 2007. REMS can be required at approval or post-approval based on emerging safety data.
When answering any REMS/ETASU question, always include the Implementation System requirement and the statutory basis.

ICH E6(R3) — RISK-BASED QUALITY MANAGEMENT (RBQM):
"RBQM" is an industry term (popularised by TransCelerate) for the quality management approach that is a core principle of ICH E6(R3) (finalised 2023, effective 2025). ICH E6(R3) does NOT use the acronym "RBQM" — it describes the same concept through these principles:
- Quality Management System (QMS): sponsors must establish a QMS with a risk-proportionate approach throughout the trial lifecycle.
- Fit-for-purpose: oversight activities (monitoring, audits, SDV) should be proportionate to the risk of each trial activity — not applied uniformly.
- Quality Tolerance Limits (QTLs): pre-defined thresholds for critical quality and safety parameters; breaching a QTL triggers investigation.
- Centralized monitoring: systematic, risk-based review of accumulating data as a complement or alternative to on-site monitoring.
- Proportionality: the level of control applied to any process should match the risk that process poses to patient safety and data integrity.
Key shift from E6(R2): R2 implied 100% source data verification (SDV) as the standard. R3 explicitly states that on-site monitoring and SDV should be risk-based and fit-for-purpose — not conducted by default.
When answering any RBQM question, explicitly connect the industry term to the E6(R3) language above.

**FEDERAL REGISTER USAGE RULE:**
The <federal_register_live_data> block contains recent FDA notices that may cover tobacco, food, devices, cosmetics, and other non-drug topics. You MUST apply this filter before using any Federal Register item: only include it in your answer if it is directly relevant to the user's specific question (same therapeutic area, regulatory pathway, or drug/biologic topic). If no Federal Register item is relevant to the question, do not mention the Federal Register at all. Never surface tobacco, food, or device-only regulatory actions in response to a pharmaceutical/clinical trial/pharmacovigilance question.

Always be precise, accurate, and practical for working regulatory professionals.`

// Industry acronym → regulatory language expansion map
// Covers terms that appear in industry practice but NOT verbatim in official guidances.
// Applied before HyDE so the hypothetical excerpt uses document language.
const TERM_EXPANSIONS: Record<string, string> = {
  'Type IB': 'Type IB variation EMA notify and wait 30 days objection competent authority Commission Regulation 1234/2008 marketing authorisation',
  'Type IA': 'Type IA variation EMA do and tell notify within 12 months immediate implementation marketing authorisation',
  'Type II': 'Type II major variation EMA prior approval written approval marketing authorisation',
  'ETASU':  'ETASU elements to assure safe use REMS risk evaluation mitigation strategy FDA certification healthcare provider pharmacy restricted supply chain implementation system',
  'RBQM':   'RBQM risk-based quality management risk-proportionate quality oversight fit-for-purpose clinical trial quality management system ICH E6(R3) QTL quality tolerance limits centralized monitoring',
  'RBM':    'risk-based monitoring centralized monitoring on-site monitoring source data verification SDV risk-proportionate ICH E6(R3)',
  'RTSM':   'RTSM randomisation trial supply management interactive response technology IRT IVRS IWRS',
  'eTMF':   'eTMF electronic trial master file TMF ICH E6 essential documents',
  'CTMS':   'CTMS clinical trial management system trial oversight monitoring',
  'CDISC':  'CDISC CDASH SDTM ADaM clinical data standards FDA submission',
  'CSR':    'CSR clinical study report ICH E3 integrated summary efficacy safety',
  'CIOMS':  'CIOMS council international organisations medical sciences pharmacovigilance adverse reaction reporting',
  'PUPSIT': 'pre-use post-sterilisation integrity test sterilising grade filter integrity testing aseptic filtration membrane filter Annex 1 sterile',
  'RABS':   'restricted access barrier system barrier technology aseptic processing isolator Grade A sterile manufacturing Annex 1',
  'APS':    'aseptic process simulation media fill process simulation sterile manufacturing validation Annex 1',
  'CCS':    'contamination control strategy holistic written strategy contamination risks facility lifecycle Annex 1 sterile medicinal products',
}

function expandTerms(query: string): string {
  let expanded = query
  for (const [term, expansion] of Object.entries(TERM_EXPANSIONS)) {
    const regex = new RegExp(`\\b${term}\\b`, 'gi')
    if (regex.test(expanded)) {
      expanded = `${expanded} ${expansion}`
      break // one expansion per query is enough
    }
  }
  return expanded
}

// ── Query domain classification ───────────────────────────────────────────────
// Maps incoming query to a domain tag that is used to scope retrieval to
// relevant chunks. Returns null when the domain is ambiguous or cross-cutting.
function classifyDomain(query: string): string | null {
  const q = query.toLowerCase()
  // Pharmacovigilance / safety reporting
  if (/\b(susar|icsr|psur|pbrer|dsur|pharmacovigilan|adverse\s+(event|reaction|effect)|signal detection|benefit.risk|rmp|pv\b|eudravigilance|cioms|safety\s+report)/i.test(q)) return 'pharmacovigilance'
  // GMP / manufacturing quality
  if (/\b(gmp|cleanroom|grade [abcd]\b|annex\s*1|annex\s*one|sterile|aseptic|contamination|manufacturing|batch\s+record|validation|cleaning\s+valid)/i.test(q)) return 'GMP'
  // GCP / clinical trials
  if (/\b(gcp|clinical\s+trial|investigat|ich\s+e\d|e6\(r[23]\)|protocol|cra\b|monitoring|randomis|irt\b|rtsm|etmf|ctms|rbqm|rbm\b|sdv\b|qtl\b)/i.test(q)) return 'GCP'
  // CMC / chemistry manufacturing controls
  if (/\b(cmc\b|specification|stability|analytical|method valid|impurit|excipient|container\s+closure|drug\s+substance|drug\s+product)/i.test(q)) return 'CMC'
  // Registration / submissions
  if (/\b(nda\b|bla\b|anda\b|ind\b|maa\b|cta\b|ectd|ctd\b|submission|dossier|type i[ab]\b|type ii\b|variation|orphan|breakthrough|prime\b|fast\s+track)/i.test(q)) return 'registration'
  return null // cross-cutting — do not filter
}

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

// ── Model routing ─────────────────────────────────────────────────────────────
type ChatMsg = { role: 'user' | 'assistant'; content: string }

async function generateAnswer(
  model: ModelId,
  systemPrompt: string,
  history: ChatMsg[],
  userContent: string,
): Promise<string> {
  const config = MODEL_CONFIGS[model]

  if (config.provider === 'groq') {
    const completion = await groq.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userContent },
      ],
      max_tokens: 4096,
      temperature: 0.3,
    })
    return completion.choices[0]?.message?.content ?? ''
  }

  if (config.provider === 'cohere') {
    // Command A+ requires v2 API — messages array with system role
    const response = await getCohere().v2.chat({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({
          role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        })),
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
    })
    console.log('[cohere] response keys:', Object.keys(response ?? {}))
    // v2 response: response.message.content is an array of content blocks
    const content = (response as Record<string, unknown>)?.message as Record<string, unknown> | undefined
    const blocks = content?.content as Array<Record<string, unknown>> | undefined
    const text = blocks?.[0]?.text as string | undefined
    if (!text) console.log('[cohere] unexpected response shape:', JSON.stringify(response).slice(0, 500))
    return text ?? ''
  }

  throw new Error(`Unknown provider for model: ${model}`)
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
    const { message, history = [], model: requestedModel } = JSON.parse(event.body!)
    const model: ModelId = (requestedModel in MODEL_CONFIGS) ? requestedModel as ModelId : DEFAULT_MODEL
    console.log(`[chat] model=${model} provider=${MODEL_CONFIGS[model].provider}`)

    if (!message?.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing message' }) }
    }

    // 1. Expand industry acronyms → regulatory language, classify domain, then generate HyDE + fetch FR in parallel
    const expandedQuery = expandTerms(message)
    const queryDomain = classifyDomain(message)
    console.log(`[chat] domain=${queryDomain ?? 'null (cross-cutting)'}`)
    const [hypotheticalExcerpt, fdaContext] = await Promise.all([
      generateHypotheticalExcerpt(expandedQuery),
      fetchFdaContext(),
    ])

    // Embed the HyDE excerpt — formal regulatory language matches corpus chunks better
    // than embedding the raw conversational query
    const { data: embedData } = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: hypotheticalExcerpt,
    })
    const queryEmbedding = embedData[0].embedding

    // 2. Hybrid retrieval: RRF over semantic (HyDE embedding) + keyword (raw query)
    // Newsletter chunks still use pure semantic — they're prose, not formal legal text
    const [docResult, newsResult] = await Promise.all([
      supabase.rpc('hybrid_match_document_chunks', {
        query_text: expandedQuery,
        query_embedding: queryEmbedding,
        match_count: 8,
        p_user_id: user.id,
        ...(queryDomain ? { p_domain: queryDomain } : {}),
      }),
      supabase.rpc('match_newsletter_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: 0.45,
        match_count: 5,
      }),
    ])
    if (docResult.error) throw docResult.error

    const chunks = docResult.data ?? []
    // Only use newsletter chunks when no primary document chunks matched —
    // prevents newsletter summaries from competing with authoritative source docs.
    const newsletterChunks = chunks.length === 0 ? (newsResult.data ?? []) : []

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

    // Hybrid retrieval returns RRF scores (~0.01–0.03), not cosine similarity.
    // Confidence is binary: if chunks came back they matched via keyword or semantic — trust them.
    const isLowConfidence = sources.length === 0

    if (contextParts.length > 0) {
      // Number each source so the AI can cite them inline as [1], [2], etc.
      const numberedContext = sources
        .map((s, i) => `[${i + 1}] ${s.source_type === 'newsletter' ? 'Newsletter' : 'Document'}: ${s.document_name}\n${s.content}`)
        .join('\n\n---\n\n')
      contextBlock =
        '<regulatory_context>\nThe following sources are available. Cite them inline in your answer using [1], [2], etc. when drawing on specific content.\n\n' +
        numberedContext +
        `\n</regulatory_context>`
    } else {
      const domainHint = queryDomain
        ? ` (searched domain: ${queryDomain})`
        : ''
      contextBlock =
        `<confidence_note>No matching content was found in the user's uploaded regulatory documents or newsletters for this question${domainHint}. ` +
        `You MUST open your answer with this exact sentence: "I do not have sufficient source material to answer this reliably. Please consult the relevant regulatory authority's official guidance or publications directly." ` +
        `Then you may offer general regulatory knowledge clearly labelled as such, but do NOT present it as if sourced from the user's documents.</confidence_note>`
    }

    const userContent = [contextBlock, fdaContext, `Question: ${message}`].filter(Boolean).join('\n\n')

    // 4. Generate answer via selected model/provider
    const answerText = await generateAnswer(
      model,
      SYSTEM_PROMPT,
      history as ChatMsg[],
      userContent,
    )

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: answerText,
        sources,
        lowConfidence: isLowConfidence,
        model,
        modelLabel: MODEL_CONFIGS[model].label,
      }),
    }
  } catch (err: unknown) {
    const msg = err instanceof Error
      ? err.message
      : (err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : 'Unknown error')
    console.error('chat error:', msg, err)
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}
