import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Newspaper, Calendar, ChevronDown, ChevronUp, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

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
