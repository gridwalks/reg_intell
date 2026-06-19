import { schedule } from '@netlify/functions'
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

function getSupabaseUrl(): string {
  const dbUrl = process.env.SUPABASE_DATABASE_URL ?? ''
  const match = dbUrl.match(/postgres\.([^:@]+)[^@]*@/)
  if (match) return `https://${match[1]}.supabase.co`
  return process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
}

const supabase = createClient(getSupabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY!)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

type ArticleAnalysis = {
  summary: string
  impact_assessment: string
  audience_tag: 'sponsor' | 'vendor' | 'both' | 'low_relevance'
  relevance_score: number
}

function buildBatchPrompt(
  articles: Array<{ title: string; source: string; url: string; content: string }>
): string {
  return `You are a pharmaceutical regulatory intelligence analyst briefing pharma sponsors and eClinical/CRO vendors.

Analyze these ${articles.length} articles and return a JSON array with exactly ${articles.length} objects in the same order.

Each object must have these exact keys:
- "summary": 2-3 sentences on the key point. No em-dashes.
- "impact_assessment": 1-2 sentences on regulatory/quality relevance. Name specific frameworks where applicable (GMP, GCP, CSV/CSA, 21 CFR Part 11, Annex 11, GAMP 5, pharmacovigilance, eClinical systems). If not directly relevant, write "Limited direct regulatory impact."
- "audience_tag": exactly one of: "sponsor" | "vendor" | "both" | "low_relevance"
- "relevance_score": integer 1-10

Scoring guide:
8-10: Direct regulatory action, new guidance issued, enforcement action, significant policy change
5-7: Industry trend, M&A with regulatory angle, technology change affecting GxP systems
3-4: Background context, loosely relevant to pharma/biotech/eClinical
1-2: General business or financial news with no meaningful regulatory angle

audience_tag guide:
"sponsor": primarily relevant to pharma/biotech as MAH, IND/CTA holder, or development sponsor
"vendor": primarily relevant to CROs, eClinical vendors, CDMOs, software/tech vendors serving pharma
"both": relevant to both audiences
"low_relevance": relevance_score below 5 or content is not relevant to this audience

${articles.map((a, i) => `--- Article ${i + 1} ---
Source: ${a.source}
Title: ${a.title}
URL: ${a.url}
Content: ${a.content.slice(0, 1200)}`).join('\n\n')}

Return ONLY a valid JSON array. No markdown fences, no prose before or after.`
}

function extractJSON(text: string): unknown {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error(`No JSON array found in response. Preview: ${text.slice(0, 200)}`)
  return JSON.parse(match[0])
}

const analyzeHandler: Handler = async () => {
  console.log('[analyze-news] Starting batch analysis')

  // Load all articles awaiting analysis
  const { data: articles, error } = await supabase
    .from('news_articles')
    .select('id, title, url, raw_content, source_id, news_sources(name)')
    .eq('status', 'pending_analysis')
    .order('published_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[analyze-news] DB error:', error.message)
    return { statusCode: 500, body: error.message }
  }

  if (!articles || articles.length === 0) {
    console.log('[analyze-news] No articles to analyze')
    return { statusCode: 200, body: 'No articles pending' }
  }

  console.log(`[analyze-news] Analyzing ${articles.length} articles in batches of 5`)

  const BATCH_SIZE = 5
  let analyzed = 0
  let errors = 0

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE)

    // Mark as analyzing to prevent re-processing on retry
    const batchIds = batch.map(a => a.id)
    await supabase
      .from('news_articles')
      .update({ status: 'analyzing' })
      .in('id', batchIds)

    try {
      const batchInput = batch.map(a => ({
        title: a.title,
        source: (a.news_sources as { name: string } | null)?.name ?? 'Unknown',
        url: a.url,
        content: a.raw_content ?? '',
      }))

      const response = await anthropic.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 2048,
        messages: [{ role: 'user', content: buildBatchPrompt(batchInput) }],
      })

      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')

      const results = extractJSON(text) as ArticleAnalysis[]

      if (!Array.isArray(results) || results.length !== batch.length) {
        throw new Error(`Expected ${batch.length} results, got ${Array.isArray(results) ? results.length : 'non-array'}`)
      }

      for (let j = 0; j < batch.length; j++) {
        const art = batch[j]
        const res = results[j]

        await supabase
          .from('news_articles')
          .update({
            status: 'analyzed',
            ai_summary: res.summary,
            ai_impact_assessment: res.impact_assessment,
            ai_audience_tag: res.audience_tag,
            ai_relevance_score: Math.min(10, Math.max(1, Math.round(res.relevance_score))),
            analyzed_at: new Date().toISOString(),
          })
          .eq('id', art.id)

        analyzed++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[analyze-news] Batch ${i}-${i + batch.length} failed:`, msg)

      await supabase
        .from('news_articles')
        .update({ status: 'error', ai_error: msg })
        .in('id', batchIds)

      errors += batch.length
    }
  }

  console.log(`[analyze-news] Done. Analyzed: ${analyzed}, Errors: ${errors}`)
  return { statusCode: 200, body: JSON.stringify({ analyzed, errors }) }
}

// Runs daily at 06:30 UTC (30 min after ingestion)
export const handler = schedule('30 6 * * *', analyzeHandler)
