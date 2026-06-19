import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Newspaper, Calendar, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Newsletter = {
  id: string
  draft_date: string
  intro_text: string | null
  sponsor_section: string | null
  vendor_section: string | null
  article_count: number | null
  published_at: string | null
}

export default function NewsPage() {
  const [newsletters, setNewsletters] = useState<Newsletter[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('newsletter_drafts')
      .select('id, draft_date, intro_text, sponsor_section, vendor_section, article_count, published_at')
      .eq('status', 'published')
      .order('draft_date', { ascending: false })
      .then(({ data }) => {
        setNewsletters(data ?? [])
        if (data && data.length > 0) setExpanded(data[0].id)
        setLoading(false)
      })
  }, [])

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
          {newsletters.map(nl => (
            <div key={nl.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
                onClick={() => setExpanded(expanded === nl.id ? null : nl.id)}
              >
                <div className="flex items-center gap-3 text-left">
                  <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
                  <div>
                    <p className="font-semibold text-gray-900">
                      {new Date(nl.draft_date + 'T12:00:00Z').toLocaleDateString('en-US', {
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </p>
                    {nl.article_count != null && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {nl.article_count} article{nl.article_count !== 1 ? 's' : ''} included
                      </p>
                    )}
                  </div>
                </div>
                {expanded === nl.id
                  ? <ChevronUp className="w-4 h-4 text-gray-400" />
                  : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {expanded === nl.id && (
                <div className="border-t border-gray-100 px-6 py-6 space-y-8">
                  {nl.intro_text && (
                    <p className="text-gray-700 leading-relaxed">{nl.intro_text}</p>
                  )}

                  <Section title="Sponsor impact" content={nl.sponsor_section} />
                  <Section title="Vendor and eClinical impact" content={nl.vendor_section} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Section({ title, content }: { title: string; content: string | null }) {
  if (!content) return null
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">
        {title}
      </h2>
      <div className="prose-chat">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  )
}
