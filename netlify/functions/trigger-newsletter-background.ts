import type { BackgroundHandler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import Parser from 'rss-parser'

function getSupabaseUrl(): string {
  const dbUrl = process.env.SUPABASE_DATABASE_URL ?? ''
  const match = dbUrl.match(/postgres\.([^:@]+)[^@]*@/)
  if (match) return `https://${match[1]}.supabase.co`
  return process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
}

const supabase = createClient(getSupabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY!)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'RegIntel/1.0' },
})

// ── Article text extraction ───────────────────────────────────────────────────

async function fetchArticleText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RegIntel/1.0)' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    let html = await res.text()
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    if (articleMatch) html = articleMatch[1]
    else if (mainMatch) html = mainMatch[1]
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000)
  } catch { return null }
}

// ── Step 1: Ingest ────────────────────────────────────────────────────────────

async function ingest(): Promise<number> {
  const { data: sources } = await supabase
    .from('news_sources')
    .select('*')
    .eq('access_status', 'active')
    .not('feed_url', 'is', null)

  const since = new Date(Date.now() - 25 * 60 * 60 * 1000)
  let total = 0

  for (const source of sources ?? []) {
    try {
      const feed = await parser.parseURL(source.feed_url)
      for (const item of feed.items) {
        const pubDate = item.isoDate || item.pubDate
        const publishedAt = pubDate ? new Date(pubDate) : null
        if (publishedAt && publishedAt < since) continue

        const url = (item.link ?? '').trim()
        if (!url) continue

        const { count } = await supabase
          .from('news_articles')
          .select('id', { count: 'exact', head: true })
          .eq('url', url)
        if ((count ?? 0) > 0) continue

        let rawContent =
          (item.contentSnippet ?? '').trim() ||
          (item.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ||
          (item.summary ?? '').trim()
        let contentTruncated = rawContent.length < 400

        if (source.full_fetch_needed || contentTruncated) {
          const fetched = await fetchArticleText(url)
          if (fetched && fetched.length > rawContent.length) {
            rawContent = fetched
            contentTruncated = false
          }
        }

        await supabase.from('news_articles').insert({
          source_id: source.id,
          title: (item.title ?? 'Untitled').trim(),
          url,
          published_at: publishedAt?.toISOString() ?? null,
          raw_content: rawContent.slice(0, 8000),
          content_truncated: contentTruncated,
          status: 'pending_analysis',
        })
        total++
      }
      await supabase
        .from('news_sources')
        .update({ last_fetched_at: new Date().toISOString() })
        .eq('id', source.id)
    } catch (err) {
      console.error(`[trigger] ingest error for ${source.name}:`, err)
    }
  }
  return total
}

// ── Step 2: Analyze ───────────────────────────────────────────────────────────

function buildBatchPrompt(
  articles: Array<{ title: string; source: string; url: string; content: string }>
): string {
  return `You are a pharmaceutical regulatory intelligence analyst.

Analyze these ${articles.length} articles and return a JSON array with exactly ${articles.length} objects in the same order.

Each object must have:
- "summary": 2-3 sentences on the key point. No em-dashes.
- "impact_assessment": 1-2 sentences on regulatory/quality relevance (GMP, GCP, CSV/CSA, 21 CFR Part 11, Annex 11, GAMP 5, pharmacovigilance, eClinical). If not relevant write "Limited direct regulatory impact."
- "audience_tag": "sponsor" | "vendor" | "both" | "low_relevance"
- "relevance_score": integer 1-10 (8-10=direct regulatory action; 5-7=industry trend with reg angle; 3-4=loosely relevant; 1-2=not relevant)

${articles.map((a, i) => `--- Article ${i + 1} ---
Source: ${a.source}
Title: ${a.title}
Content: ${a.content.slice(0, 1200)}`).join('\n\n')}

Return ONLY a valid JSON array. No markdown fences.`
}

function extractJSONArray(text: string): unknown[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('No JSON array found')
  return JSON.parse(match[0]) as unknown[]
}

async function analyze(): Promise<number> {
  const { data: articles } = await supabase
    .from('news_articles')
    .select('id, title, url, raw_content, source_id, news_sources(name)')
    .eq('status', 'pending_analysis')
    .order('published_at', { ascending: false })
    .limit(100)

  if (!articles || articles.length === 0) return 0

  const BATCH = 5
  let analyzed = 0

  for (let i = 0; i < articles.length; i += BATCH) {
    const batch = articles.slice(i, i + BATCH)
    const ids = batch.map(a => a.id)
    await supabase.from('news_articles').update({ status: 'analyzing' }).in('id', ids)

    try {
      const input = batch.map(a => ({
        title: a.title,
        source: (a.news_sources as { name: string } | null)?.name ?? 'Unknown',
        url: a.url,
        content: a.raw_content ?? '',
      }))

      const response = await anthropic.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 2048,
        messages: [{ role: 'user', content: buildBatchPrompt(input) }],
      })

      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
      const results = extractJSONArray(text) as Array<{
        summary: string; impact_assessment: string; audience_tag: string; relevance_score: number
      }>

      for (let j = 0; j < batch.length; j++) {
        const res = results[j]
        await supabase.from('news_articles').update({
          status: 'analyzed',
          ai_summary: res.summary,
          ai_impact_assessment: res.impact_assessment,
          ai_audience_tag: res.audience_tag,
          ai_relevance_score: Math.min(10, Math.max(1, Math.round(res.relevance_score))),
          analyzed_at: new Date().toISOString(),
        }).eq('id', batch[j].id)
        analyzed++
      }
    } catch (err) {
      console.error('[trigger] analyze batch error:', err)
      await supabase.from('news_articles')
        .update({ status: 'error', ai_error: String(err) })
        .in('id', ids)
    }
  }
  return analyzed
}

// ── Step 3: Assemble ──────────────────────────────────────────────────────────

async function assemble(today: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from('newsletter_drafts')
    .select('id')
    .eq('draft_date', today)
    .single()
  if (existing) return existing.id // already exists, skip

  const THRESHOLD = 5
  const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()

  const { data: articles } = await supabase
    .from('news_articles')
    .select('id, title, url, ai_summary, ai_impact_assessment, ai_audience_tag, ai_relevance_score, news_sources(name)')
    .eq('status', 'analyzed')
    .gte('ai_relevance_score', THRESHOLD)
    .gte('ingested_at', since)
    .order('ai_relevance_score', { ascending: false })

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

  let intro = 'No articles above the relevance threshold were available today.'
  let sponsorSection = 'No significant updates today for this audience.'
  let vendorSection = 'No significant updates today for this audience.'

  if (eligible.length > 0) {
    const sponsor = eligible.filter(a => a.ai_audience_tag === 'sponsor' || a.ai_audience_tag === 'both')
    const vendor = eligible.filter(a => a.ai_audience_tag === 'vendor' || a.ai_audience_tag === 'both')

    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })
    const fmtArticle = (a: typeof eligible[0]) =>
      `Title: ${a.title}\nSource: ${a.source}\nURL: ${a.url}\nSummary: ${a.ai_summary}\nRegulatory impact: ${a.ai_impact_assessment}`

    const prompt = `You are the editor of RegIntel, a daily regulatory intelligence briefing for pharma sponsors and eClinical/CRO vendors.

Today is ${dateStr}. Assemble the daily newsletter from the analyzed articles below.

Return a single JSON object:
{
  "intro": "<2-3 sentence paragraph framing today's key regulatory themes>",
  "sponsor_section": "<markdown>",
  "vendor_section": "<markdown>"
}

Rules: sentence case for headings, no em-dashes. Format each article as:
### [Article title]
*[Source]* | [linked URL]

[Summary]

**Regulatory impact:** [Impact]

If a section is empty write: "No significant updates today for this audience."

SPONSOR IMPACT (${sponsor.length} articles):
${sponsor.length ? sponsor.map(fmtArticle).join('\n\n') : 'None'}

VENDOR & ECLINICAL IMPACT (${vendor.length} articles):
${vendor.length ? vendor.map(fmtArticle).join('\n\n') : 'None'}

Return ONLY valid JSON. No markdown fences.`

    try {
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: prompt }],
      })
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
      const match = text.match(/\{[\s\S]*\}/)
      if (match) {
        const draft = JSON.parse(match[0]) as { intro: string; sponsor_section: string; vendor_section: string }
        intro = draft.intro
        sponsorSection = draft.sponsor_section
        vendorSection = draft.vendor_section
      }
    } catch (err) {
      console.error('[trigger] assemble Claude error:', err)
      const fmtFallback = (a: typeof eligible[0]) =>
        `### ${a.title}\n*${a.source}* | [link](${a.url})\n\n${a.ai_summary}\n\n**Regulatory impact:** ${a.ai_impact_assessment}`
      intro = `Regulatory intelligence summary for ${today}. (Assembly failed — please edit sections.)`
      sponsorSection = sponsor.length ? sponsor.map(fmtFallback).join('\n\n---\n\n') : 'No significant updates today for this audience.'
      vendorSection  = vendor.length  ? vendor.map(fmtFallback).join('\n\n---\n\n')  : 'No significant updates today for this audience.'
    }
  }

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
    console.error('[trigger] draft insert error:', draftErr?.message)
    return null
  }

  if (eligible.length > 0) {
    await supabase.from('newsletter_draft_articles').insert(
      eligible.map(a => ({
        draft_id: draft.id,
        article_id: a.id,
        section: (a.ai_audience_tag === 'both' ? 'both' : a.ai_audience_tag === 'sponsor' ? 'sponsor' : 'vendor') as 'sponsor' | 'vendor' | 'both',
      }))
    )
    await supabase.from('news_articles').update({ status: 'included' }).in('id', eligible.map(a => a.id))
  }

  const { data: remaining } = await supabase
    .from('news_articles').select('id').eq('status', 'analyzed').gte('ingested_at', since)
  if (remaining?.length) {
    await supabase.from('news_articles').update({ status: 'excluded' }).in('id', remaining.map(a => a.id))
  }

  return draft.id
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler: BackgroundHandler = async (event) => {
  // Verify caller is authenticated
  const token = event.headers.authorization?.replace('Bearer ', '')
  if (!token) return
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) { console.log('[trigger] auth failed'); return }

  const today = new Date().toISOString().slice(0, 10)
  console.log(`[trigger] Running full pipeline for ${today}`)

  const ingested = await ingest()
  console.log(`[trigger] Ingested ${ingested} articles`)

  const analyzed = await analyze()
  console.log(`[trigger] Analyzed ${analyzed} articles`)

  const draftId = await assemble(today)
  console.log(`[trigger] Draft: ${draftId ?? 'skipped (already exists)'}`)
}
