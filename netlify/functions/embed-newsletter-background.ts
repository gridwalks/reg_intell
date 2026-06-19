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

function chunkText(text: string, chunkSize = 1200, overlap = 150): string[] {
  const chunks: string[] = []
  const paragraphs = text.split(/\n{2,}/)
  let current = ''
  for (const para of paragraphs) {
    if (current.length + para.length < chunkSize) {
      current += (current ? '\n\n' : '') + para
    } else {
      if (current) chunks.push(current.trim())
      current = para
    }
  }
  if (current.trim()) chunks.push(current.trim())

  const overlapped: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    overlapped.push(i === 0 ? chunks[i] : chunks[i - 1].slice(-overlap) + '\n\n' + chunks[i])
  }
  return overlapped.filter(c => c.trim().length > 30)
}

export const handler: BackgroundHandler = async (event) => {
  const token = event.headers.authorization?.replace('Bearer ', '')
  if (!token) return

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return

  let draft_id: string | undefined
  try {
    const body = JSON.parse(event.body!)
    draft_id = body.draft_id
    if (!draft_id) return

    // Fetch draft
    const { data: draft, error: draftErr } = await supabase
      .from('newsletter_drafts')
      .select('id, draft_date, intro_text, sponsor_section, vendor_section, status')
      .eq('id', draft_id)
      .single()
    if (draftErr || !draft || draft.status !== 'published') return

    // Fetch included articles with AI summaries
    const { data: articleRows } = await supabase
      .from('newsletter_draft_articles')
      .select('news_articles(title, url, ai_summary, ai_impact_assessment, ai_audience_tag)')
      .eq('draft_id', draft_id)

    const articles = (articleRows ?? []).map(r => r.news_articles as {
      title: string; url: string; ai_summary: string | null;
      ai_impact_assessment: string | null; ai_audience_tag: string | null
    } | null).filter(Boolean)

    // Build full text corpus for this newsletter
    const parts: string[] = []
    const dateStr = new Date(draft.draft_date + 'T12:00:00Z').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })

    if (draft.intro_text) {
      parts.push(`Newsletter dated ${dateStr}\n\n${draft.intro_text}`)
    }
    if (draft.sponsor_section) {
      parts.push(`Sponsor Impact (${dateStr}):\n\n${draft.sponsor_section}`)
    }
    if (draft.vendor_section) {
      parts.push(`Vendor and eClinical Impact (${dateStr}):\n\n${draft.vendor_section}`)
    }

    // Add each article as its own searchable block
    for (const a of articles) {
      if (!a) continue
      const lines = [`Article: ${a.title}`]
      if (a.ai_summary) lines.push(`Summary: ${a.ai_summary}`)
      if (a.ai_impact_assessment) lines.push(`Impact: ${a.ai_impact_assessment}`)
      if (a.ai_audience_tag) lines.push(`Audience: ${a.ai_audience_tag}`)
      lines.push(`Source: ${a.url}`)
      lines.push(`Newsletter date: ${dateStr}`)
      parts.push(lines.join('\n'))
    }

    const fullText = parts.join('\n\n---\n\n')
    if (fullText.trim().length < 50) return

    // Delete any existing chunks for this draft (re-embedding on re-publish)
    await supabase.from('newsletter_chunks').delete().eq('newsletter_draft_id', draft_id)

    const chunks = chunkText(fullText)
    const BATCH = 20

    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH)
      const { data: embedData } = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: batch,
      })
      const rows = batch.map((content, j) => ({
        newsletter_draft_id: draft_id,
        content,
        embedding: embedData[j].embedding,
        chunk_index: i + j,
        draft_date: draft.draft_date,
      }))
      const { error: insertErr } = await supabase.from('newsletter_chunks').insert(rows)
      if (insertErr) throw insertErr
    }

    console.log(`[embed-newsletter] embedded ${chunks.length} chunks for draft ${draft_id}`)
  } catch (err) {
    console.error('[embed-newsletter] error:', err)
  }
}
