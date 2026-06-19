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

type DraftJSON = { intro: string; sponsor_section: string; vendor_section: string }

function extractJSON(text: string): DraftJSON {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found in assembly response')
  return JSON.parse(match[0]) as DraftJSON
}

function buildAssemblyPrompt(
  dateStr: string,
  articles: Array<{
    title: string; source: string; url: string
    ai_summary: string; ai_impact_assessment: string
    ai_audience_tag: string; ai_relevance_score: number
  }>
): string {
  const sponsor = articles.filter(a => a.ai_audience_tag === 'sponsor' || a.ai_audience_tag === 'both')
  const vendor  = articles.filter(a => a.ai_audience_tag === 'vendor'  || a.ai_audience_tag === 'both')

  const formatArticle = (a: typeof articles[0]) =>
    `Title: ${a.title}
Source: ${a.source}
URL: ${a.url}
Summary: ${a.ai_summary}
Regulatory impact: ${a.ai_impact_assessment}`

  return `You are the editor of RegIntel, a daily regulatory intelligence briefing for pharma sponsors and eClinical/CRO vendors at AcceleraQA.

Today is ${dateStr}. Assemble the daily newsletter from the analyzed articles below.

Return a single JSON object with exactly these keys:
{
  "intro": "<2-3 sentence paragraph framing today's key regulatory themes>",
  "sponsor_section": "<markdown>",
  "vendor_section": "<markdown>"
}

Formatting rules:
- Sentence case for all headings (not title case)
- No em-dashes anywhere in the output
- Each article in a section formatted as:

### [Article title]
*[Source name]* | [URL as markdown link using the URL]

[Summary text]

**Regulatory impact:** [Impact assessment]

- If a section has no articles, write exactly: "No significant updates today for this audience."
- Do not rewrite or embellish the summaries; use the pre-analyzed text with minimal editing for flow

SPONSOR IMPACT articles (${sponsor.length}):
${sponsor.length ? sponsor.map(formatArticle).join('\n\n') : 'None'}

VENDOR & ECLINICAL IMPACT articles (${vendor.length}):
${vendor.length ? vendor.map(formatArticle).join('\n\n') : 'None'}

Return ONLY valid JSON. No markdown fences, no prose outside the JSON.`
}

const assembleHandler: Handler = async () => {
  const today = new Date().toISOString().slice(0, 10)
  console.log(`[assemble-draft] Assembling draft for ${today}`)

  // Skip if draft already exists for today
  const { data: existing } = await supabase
    .from('newsletter_drafts')
    .select('id')
    .eq('draft_date', today)
    .single()

  if (existing) {
    console.log('[assemble-draft] Draft already exists for today, skipping')
    return { statusCode: 200, body: 'Draft already exists' }
  }

  const THRESHOLD = 5

  // Pull analyzed articles published today or yesterday (to catch overnight articles)
  const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()

  const { data: articles, error } = await supabase
    .from('news_articles')
    .select('id, title, url, ai_summary, ai_impact_assessment, ai_audience_tag, ai_relevance_score, source_id, news_sources(name)')
    .eq('status', 'analyzed')
    .gte('ai_relevance_score', THRESHOLD)
    .gte('ingested_at', since)
    .order('ai_relevance_score', { ascending: false })

  if (error) {
    console.error('[assemble-draft] DB error:', error.message)
    return { statusCode: 500, body: error.message }
  }

  const eligible = (articles ?? []).map(a => ({
    id: a.id,
    title: a.title,
    url: a.url,
    source: (a.news_sources as { name: string } | null)?.name ?? 'Unknown',
    ai_summary: a.ai_summary ?? '',
    ai_impact_assessment: a.ai_impact_assessment ?? '',
    ai_audience_tag: a.ai_audience_tag ?? 'low_relevance',
    ai_relevance_score: a.ai_relevance_score ?? 0,
  }))

  console.log(`[assemble-draft] ${eligible.length} articles above threshold`)

  let intro = 'No articles above the relevance threshold were available today.'
  let sponsorSection = 'No significant updates today for this audience.'
  let vendorSection  = 'No significant updates today for this audience.'

  if (eligible.length > 0) {
    try {
      const dateStr = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: buildAssemblyPrompt(dateStr, eligible) }],
      })

      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')

      const draft = extractJSON(text)
      intro         = draft.intro
      sponsorSection = draft.sponsor_section
      vendorSection  = draft.vendor_section
    } catch (err) {
      console.error('[assemble-draft] Claude call failed:', err)
      // Fall back to plain concatenation so the draft still exists for review
      const fmtArticle = (a: typeof eligible[0]) =>
        `### ${a.title}\n*${a.source}* | [link](${a.url})\n\n${a.ai_summary}\n\n**Regulatory impact:** ${a.ai_impact_assessment}`

      const sponsor = eligible.filter(a => a.ai_audience_tag === 'sponsor' || a.ai_audience_tag === 'both')
      const vendor  = eligible.filter(a => a.ai_audience_tag === 'vendor'  || a.ai_audience_tag === 'both')
      intro = `Regulatory intelligence summary for ${today}. Assembly prompt failed — review and edit sections below.`
      sponsorSection = sponsor.length ? sponsor.map(fmtArticle).join('\n\n---\n\n') : 'No significant updates today.'
      vendorSection  = vendor.length  ? vendor.map(fmtArticle).join('\n\n---\n\n') : 'No significant updates today.'
    }
  }

  // Save draft
  const { data: draft, error: draftErr } = await supabase
    .from('newsletter_drafts')
    .insert({
      draft_date: today,
      status: 'pending_approval',
      relevance_threshold: THRESHOLD,
      intro_text: intro,
      sponsor_section: sponsorSection,
      vendor_section: vendorSection,
      article_count: eligible.length,
    })
    .select()
    .single()

  if (draftErr || !draft) {
    console.error('[assemble-draft] Failed to save draft:', draftErr?.message)
    return { statusCode: 500, body: draftErr?.message ?? 'Failed to save draft' }
  }

  // Link articles to draft and mark as included
  if (eligible.length > 0) {
    const joinRows = eligible.map(a => ({
      draft_id: draft.id,
      article_id: a.id,
      section: (a.ai_audience_tag === 'both' ? 'both'
              : a.ai_audience_tag === 'sponsor' ? 'sponsor'
              : 'vendor') as 'sponsor' | 'vendor' | 'both',
    }))
    await supabase.from('newsletter_draft_articles').insert(joinRows)
    await supabase
      .from('news_articles')
      .update({ status: 'included' })
      .in('id', eligible.map(a => a.id))
  }

  // Mark excluded articles
  const { data: analyzed } = await supabase
    .from('news_articles')
    .select('id')
    .eq('status', 'analyzed')
    .gte('ingested_at', since)
  if (analyzed) {
    await supabase
      .from('news_articles')
      .update({ status: 'excluded' })
      .in('id', analyzed.map(a => a.id))
  }

  console.log(`[assemble-draft] Draft ${draft.id} saved with ${eligible.length} articles`)
  return { statusCode: 200, body: JSON.stringify({ draft_id: draft.id, article_count: eligible.length }) }
}

// Runs daily at 07:00 UTC (30 min after analysis)
export const handler = schedule('0 7 * * *', assembleHandler)
