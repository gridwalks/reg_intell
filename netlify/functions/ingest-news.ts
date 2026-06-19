import { schedule } from '@netlify/functions'
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import Parser from 'rss-parser'

function getSupabaseUrl(): string {
  const dbUrl = process.env.SUPABASE_DATABASE_URL ?? ''
  const match = dbUrl.match(/postgres\.([^:@]+)[^@]*@/)
  if (match) return `https://${match[1]}.supabase.co`
  return process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
}

const supabase = createClient(getSupabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY!)

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'RegIntel/1.0 (pharmaceutical regulatory intelligence aggregator)' },
})

async function fetchArticleText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RegIntel/1.0)' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    const html = await res.text()

    let cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '')

    const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    if (articleMatch) cleaned = articleMatch[1]
    else if (mainMatch) cleaned = mainMatch[1]

    return cleaned
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000)
  } catch {
    return null
  }
}

const ingestHandler: Handler = async () => {
  console.log('[ingest-news] Starting daily ingestion')

  const { data: sources, error } = await supabase
    .from('news_sources')
    .select('*')
    .eq('access_status', 'active')
    .not('feed_url', 'is', null)

  if (error) {
    console.error('[ingest-news] Failed to load sources:', error.message)
    return { statusCode: 500, body: error.message }
  }

  const since = new Date(Date.now() - 25 * 60 * 60 * 1000) // 25h window to catch slow feeds
  const summary: Record<string, { ingested: number; skipped: number; error?: string }> = {}

  for (const source of sources ?? []) {
    const result = { ingested: 0, skipped: 0 }
    try {
      const feed = await parser.parseURL(source.feed_url)

      for (const item of feed.items) {
        const pubDate = item.isoDate || item.pubDate
        const publishedAt = pubDate ? new Date(pubDate) : null

        if (publishedAt && publishedAt < since) { result.skipped++; continue }

        const url = (item.link ?? '').trim()
        if (!url) continue

        // Dedup check
        const { count } = await supabase
          .from('news_articles')
          .select('id', { count: 'exact', head: true })
          .eq('url', url)
        if ((count ?? 0) > 0) { result.skipped++; continue }

        // Extract content
        let rawContent = (item.contentSnippet ?? '').trim() ||
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
        result.ingested++
      }

      await supabase
        .from('news_sources')
        .update({ last_fetched_at: new Date().toISOString() })
        .eq('id', source.id)
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err)
      console.error(`[ingest-news] Error on ${source.name}:`, result.error)
    }
    summary[source.name] = result
  }

  console.log('[ingest-news] Done:', JSON.stringify(summary))
  return { statusCode: 200, body: JSON.stringify(summary) }
}

// Runs daily at 06:00 UTC
export const handler = schedule('0 6 * * *', ingestHandler)
