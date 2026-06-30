import type React from 'react'
import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { Newspaper, Calendar, ChevronDown, ChevronUp, Lock, ExternalLink, BookOpen, AlertCircle, FileSearch } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

// ── Federal Register types ─────────────────────────────────────────────────

type FRDoc = {
  document_number: string
  title: string
  html_url: string
  type?: string
  agencies?: { name: string }[]
  publication_date?: string
  abstract?: string
}

type FRPublicInspectionDoc = {
  document_number: string
  title: string
  html_url: string
  document_types?: { name: string }[]
  agencies?: { name: string }[]
}

type FRData = {
  publicInspection: FRPublicInspectionDoc[]
  significant: FRDoc[]
  published: FRDoc[]
  error: string | null
}

type Newsletter = {
  id: string
  draft_date: string
  intro_text: string | null
  sponsor_section: string | null
  vendor_section: string | null
  article_count: number | null
  published_at: string | null
  is_paid: boolean
}

function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim()
}

export default function NewsPage() {
  const { tier } = useAuth()
  const [newsletters, setNewsletters] = useState<Newsletter[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Free users can read non-paid newsletters; paid requires newsletter or platform tier
  const canRead = (nl: Newsletter) =>
    !nl.is_paid || tier === 'newsletter' || tier === 'platform'

  useEffect(() => {
    supabase
      .from('newsletter_drafts')
      .select('id, draft_date, intro_text, sponsor_section, vendor_section, article_count, published_at, is_paid')
      .eq('status', 'published')
      .order('draft_date', { ascending: false })
      .then(({ data }) => {
        setNewsletters(data ?? [])
        if (data && data.length > 0) setExpanded(data[0].id)
        setLoading(false)
      })
  }, [])

  const toggle = (nl: Newsletter) => {
    if (!canRead(nl)) return // free users can't expand paid newsletters
    setExpanded(expanded === nl.id ? null : nl.id)
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <Newspaper className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Regulatory Intelligence News</h1>
        </div>
        <p className="text-gray-500 text-sm">
          Daily briefings curated for pharma sponsors and eClinical/CRO vendors.
        </p>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm">Loading...</div>
      ) : newsletters.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Newspaper className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No newsletters published yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {newsletters.map(nl => {
            const isExpanded = expanded === nl.id
            const locked = !canRead(nl)
            return (
              <div key={nl.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <button
                  className={`w-full flex items-center justify-between px-6 py-4 transition-colors ${locked ? 'cursor-default' : 'hover:bg-gray-50'}`}
                  onClick={() => toggle(nl)}
                >
                  <div className="flex items-center gap-3 text-left">
                    <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900">
                          {new Date(nl.draft_date + 'T12:00:00Z').toLocaleDateString('en-US', {
                            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                          })}
                        </p>
                        {nl.is_paid && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                            <Lock className="w-2.5 h-2.5" /> Newsletter
                          </span>
                        )}
                      </div>
                      {nl.article_count != null && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {nl.article_count} article{nl.article_count !== 1 ? 's' : ''} included
                        </p>
                      )}
                    </div>
                  </div>
                  {locked
                    ? <Lock className="w-4 h-4 text-gray-300" />
                    : isExpanded
                      ? <ChevronUp className="w-4 h-4 text-gray-400" />
                      : <ChevronDown className="w-4 h-4 text-gray-400" />
                  }
                </button>

                {/* Preview — always shown when collapsed */}
                {!isExpanded && (nl.intro_text || nl.sponsor_section) && (
                  <div className="relative px-6 pb-5 overflow-hidden" style={{ maxHeight: '5.5rem' }}>
                    <p className="text-sm text-gray-500 leading-relaxed line-clamp-4">
                      {stripMarkdown(nl.intro_text || nl.sponsor_section || '')}
                    </p>
                    <div className="absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-white to-transparent" />
                  </div>
                )}

                {/* Upgrade prompt for free users on paid newsletters */}
                {!isExpanded && locked && (
                  <div className="px-6 pb-5">
                    <div className="flex items-center gap-2 mt-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <Lock className="w-3.5 h-3.5 shrink-0" />
                      This edition is available to Newsletter subscribers. Upgrade to read the full briefing.
                    </div>
                  </div>
                )}

                {/* Full content for paid/platform users */}
                {isExpanded && !locked && (
                  <div className="border-t border-gray-100 px-6 py-6 space-y-8">
                    <Section title="" content={nl.intro_text} />
                    <Section title="Sponsor impact" content={nl.sponsor_section} />
                    <Section title="Vendor and eClinical impact" content={nl.vendor_section} />
                    <FederalRegisterSection date={nl.draft_date} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FederalRegisterSection({ date }: { date: string }) {
  const [data, setData] = useState<FRData | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    if (data) return
    setLoading(true)
    const base = 'https://www.federalregister.gov/api/v1'
    const docFields = 'fields[]=title&fields[]=document_number&fields[]=html_url&fields[]=type&fields[]=agencies&fields[]=abstract&fields[]=publication_date'

    // Week-ago date for significant docs
    const d = new Date(date + 'T12:00:00Z')
    const weekAgo = new Date(d)
    weekAgo.setDate(d.getDate() - 7)
    const weekAgoStr = weekAgo.toISOString().slice(0, 10)

    try {
      const fda = 'conditions[agencies][]=food-and-drug-administration'
      const [piRes, sigRes, pubRes] = await Promise.all([
        fetch(`${base}/public-inspection-documents.json?fields[]=title&fields[]=document_number&fields[]=html_url&fields[]=document_types&fields[]=agencies&per_page=20&${fda}`),
        fetch(`${base}/documents.json?per_page=15&order=newest&${docFields}&${fda}&conditions[significant]=1&conditions[publication_date][gte]=${weekAgoStr}&conditions[publication_date][lte]=${date}`),
        fetch(`${base}/documents.json?per_page=20&order=newest&${docFields}&${fda}&conditions[publication_date][gte]=${date}&conditions[publication_date][lte]=${date}`),
      ])

      const [piJson, sigJson, pubJson] = await Promise.all([piRes.json(), sigRes.json(), pubRes.json()])

      setData({
        publicInspection: piJson.results ?? [],
        significant: sigJson.results ?? [],
        published: pubJson.results ?? [],
        error: null,
      })
    } catch {
      setData({ publicInspection: [], significant: [], published: [], error: 'Failed to load Federal Register data.' })
    }
    setLoading(false)
  }, [date, data])

  const toggle = () => {
    if (!open) load()
    setOpen(o => !o)
  }

  return (
    <div className="border border-indigo-100 rounded-xl overflow-hidden mt-8">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-indigo-50 hover:bg-indigo-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-indigo-600 shrink-0" />
          <span className="text-sm font-semibold text-indigo-800">Federal Register</span>
          <span className="text-xs text-indigo-400">— Public Inspection · Significant · Published</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-indigo-400" /> : <ChevronDown className="w-4 h-4 text-indigo-400" />}
      </button>

      {open && (
        <div className="px-4 py-4 space-y-6 bg-white">
          {loading && <p className="text-xs text-gray-400">Loading Federal Register data…</p>}
          {data?.error && (
            <div className="flex items-center gap-2 text-xs text-red-600">
              <AlertCircle className="w-3.5 h-3.5" /> {data.error}
            </div>
          )}
          {data && !data.error && (
            <>
              <FRSubSection
                title="Documents on Public Inspection"
                icon={<FileSearch className="w-3.5 h-3.5 text-amber-600" />}
                items={data.publicInspection.map(d => ({
                  number: d.document_number,
                  title: d.title,
                  url: d.html_url,
                  meta: d.document_types?.map(t => t.name).join(', ') ?? '',
                  agencies: d.agencies?.map(a => a.name) ?? [],
                }))}
                emptyMsg="No documents currently on public inspection."
              />
              <FRSubSection
                title="Significant Documents (past 7 days)"
                icon={<AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                items={data.significant.map(d => ({
                  number: d.document_number,
                  title: d.title,
                  url: d.html_url,
                  meta: d.type ?? '',
                  agencies: d.agencies?.map(a => a.name) ?? [],
                  abstract: d.abstract,
                }))}
                emptyMsg="No significant documents in the past 7 days."
              />
              <FRSubSection
                title={`Recently Published — ${new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
                icon={<Newspaper className="w-3.5 h-3.5 text-blue-500" />}
                items={data.published.map(d => ({
                  number: d.document_number,
                  title: d.title,
                  url: d.html_url,
                  meta: d.type ?? '',
                  agencies: d.agencies?.map(a => a.name) ?? [],
                  abstract: d.abstract,
                }))}
                emptyMsg={`No documents published on ${date}.`}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

type FRItem = { number: string; title: string; url: string; meta: string; agencies: string[]; abstract?: string }

function FRSubSection({ title, icon, items, emptyMsg }: {
  title: string
  icon: React.ReactNode
  items: FRItem[]
  emptyMsg: string
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
        {items.length > 0 && (
          <span className="ml-1 text-xs font-medium text-gray-400">({items.length})</span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 italic">{emptyMsg}</p>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.number} className="text-xs border border-gray-100 rounded-lg px-3 py-2 hover:bg-gray-50">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-indigo-700 hover:underline leading-snug block"
                  >
                    {item.title}
                  </a>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {item.meta && <span className="text-gray-400">{item.meta}</span>}
                    {item.agencies.slice(0, 2).map(a => (
                      <span key={a} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{a}</span>
                    ))}
                    {item.agencies.length > 2 && (
                      <span className="text-gray-400">+{item.agencies.length - 2} more</span>
                    )}
                  </div>
                  {item.abstract && (
                    <p className="text-gray-500 mt-1 line-clamp-2">{item.abstract}</p>
                  )}
                </div>
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="shrink-0 mt-0.5">
                  <ExternalLink className="w-3 h-3 text-gray-400 hover:text-indigo-600" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Section({ title, content }: { title: string; content: string | null }) {
  if (!content?.trim()) return null
  return (
    <div>
      {title && (
        <h2 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">
          {title}
        </h2>
      )}
      <div className="prose-chat">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  )
}
