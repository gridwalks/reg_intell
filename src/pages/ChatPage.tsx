import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Send, Loader2, BookOpen, AlertTriangle, Bot, User, Sparkles, X, FileText, Newspaper, ExternalLink } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

type Source = {
  document_name: string
  content: string
  similarity: number
  file_url?: string
  source_type: 'document' | 'newsletter'
  newsletter_draft_id?: string
  draft_date?: string
}

type Message = {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
}

type NewsletterDetail = {
  draft_date: string
  intro_text: string | null
  sponsor_section: string | null
  vendor_section: string | null
}

const STARTER_PROMPTS = [
  'What are the ICH Q10 requirements for pharmaceutical quality systems?',
  'Summarize the FDA guidance on process validation for drug products.',
  'What are the key elements of a Change Control procedure under GMP?',
  'Explain the EMA requirements for IMPD (Investigational Medicinal Product Dossier).',
]

export default function ChatPage() {
  const { session } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [modalUrl, setModalUrl] = useState<string | null>(null)
  const [modalTitle, setModalTitle] = useState('')
  const [newsletterModal, setNewsletterModal] = useState<NewsletterDetail | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const autoResize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const openDocument = (src: Source) => {
    if (src.source_type === 'newsletter' && src.newsletter_draft_id) {
      openNewsletter(src.newsletter_draft_id, src.draft_date ?? '')
    } else if (src.file_url) {
      setModalTitle(src.document_name)
      setModalUrl(src.file_url)
    }
  }

  const openNewsletter = async (draftId: string, draftDate: string) => {
    const { data } = await supabase
      .from('newsletter_drafts')
      .select('draft_date, intro_text, sponsor_section, vendor_section')
      .eq('id', draftId)
      .single()
    if (data) {
      setNewsletterModal(data)
    } else {
      // Fallback: navigate to news page
      setModalTitle(`Newsletter — ${draftDate}`)
    }
  }

  const sendMessage = async (text: string = input.trim()) => {
    if (!text || loading || !session) return
    setError('')
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    const userMsg: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch('/.netlify/functions/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          message: text,
          history: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error || 'Query failed')
      }

      const { message, sources } = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: message, sources }])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-600" />
          <h1 className="text-lg font-semibold text-gray-900">Intelligence Query</h1>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          Ask questions grounded in your uploaded regulatory documents and newsletters.
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 && !loading && (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Bot className="w-7 h-7 text-blue-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Regulatory Intelligence Assistant</h2>
              <p className="text-gray-500 text-sm mt-2">
                Powered by your document knowledge base and published newsletters.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {STARTER_PROMPTS.map(prompt => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="text-left p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors text-sm text-gray-700"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="max-w-3xl mx-auto w-full space-y-6">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}
              <div className={`max-w-[80%] ${msg.role === 'user' ? 'order-first' : ''}`}>
                {msg.role === 'user' ? (
                  <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm">
                    {msg.content}
                  </div>
                ) : (
                  <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm">
                    <div className="prose-chat">
                      <CitedMarkdown content={msg.content} sources={msg.sources ?? []} onOpen={openDocument} />
                    </div>
                    {msg.sources && msg.sources.length > 0 && (
                      <SourcesPanel sources={msg.sources} onOpen={openDocument} />
                    )}
                  </div>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center shrink-0 mt-1">
                  <User className="w-4 h-4 text-gray-600" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-1">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Searching documents and generating answer…
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm max-w-xl mx-auto">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 bg-white px-4 py-4 shrink-0">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-3 bg-gray-50 border border-gray-300 rounded-2xl px-4 py-3 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={e => { setInput(e.target.value); autoResize() }}
              onKeyDown={handleKeyDown}
              placeholder="Ask a regulatory question… (Enter to send, Shift+Enter for newline)"
              className="flex-1 bg-transparent resize-none outline-none text-sm text-gray-900 placeholder-gray-400 leading-relaxed max-h-48 overflow-y-auto"
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="w-9 h-9 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-xl flex items-center justify-center transition-colors shrink-0"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </button>
          </div>
          <p className="text-center text-xs text-gray-400 mt-2">
            Answers are based on your uploaded documents and newsletters. Always verify against source materials.
          </p>
        </div>
      </div>

      {/* PDF document modal */}
      {modalUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setModalUrl(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="text-sm font-medium text-gray-900 truncate">{modalTitle}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <a
                  href={modalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open in new tab
                </a>
                <button onClick={() => setModalUrl(null)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <iframe
              src={modalUrl}
              className="flex-1 w-full rounded-b-2xl"
              title={modalTitle}
            />
          </div>
        </div>
      )}

      {/* Newsletter modal */}
      {newsletterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setNewsletterModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2">
                <Newspaper className="w-4 h-4 text-indigo-600" />
                <span className="text-sm font-medium text-gray-900">
                  Newsletter — {new Date(newsletterModal.draft_date + 'T12:00:00Z').toLocaleDateString('en-US', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                  })}
                </span>
              </div>
              <button onClick={() => setNewsletterModal(null)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-6 space-y-6">
              {newsletterModal.intro_text && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Introduction</h3>
                  <p className="text-sm text-gray-700 leading-relaxed">{newsletterModal.intro_text}</p>
                </section>
              )}
              {newsletterModal.sponsor_section && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Sponsor Impact</h3>
                  <div className="prose-chat text-sm">
                    <ReactMarkdown>{newsletterModal.sponsor_section}</ReactMarkdown>
                  </div>
                </section>
              )}
              {newsletterModal.vendor_section && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Vendor & eClinical Impact</h3>
                  <div className="prose-chat text-sm">
                    <ReactMarkdown>{newsletterModal.vendor_section}</ReactMarkdown>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CitedMarkdown({ content, sources, onOpen }: {
  content: string
  sources: Source[]
  onOpen: (src: Source) => void
}) {
  // Inject citation buttons into text nodes without breaking markdown structure.
  // We render one ReactMarkdown and override block-level components to
  // post-process their children, substituting [N] markers inline.
  const injectCitations = (node: React.ReactNode): React.ReactNode => {
    if (typeof node === 'string') {
      const parts = node.split(/(\[\d+\])/g)
      if (parts.length === 1) return node
      return parts.map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/)
        if (!m) return part
        const idx = parseInt(m[1], 10) - 1
        const src = sources[idx]
        if (!src) return part
        const isClickable = src.source_type === 'newsletter' || !!src.file_url
        return (
          <sup key={i}>
            {isClickable ? (
              <button
                onClick={() => onOpen(src)}
                className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-indigo-100 text-indigo-700 hover:bg-indigo-600 hover:text-white transition-colors mx-0.5 leading-none"
                title={src.document_name}
              >
                {idx + 1}
              </button>
            ) : (
              <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-gray-100 text-gray-500 mx-0.5 leading-none">
                {idx + 1}
              </span>
            )}
          </sup>
        )
      })
    }
    if (React.isValidElement(node) && node.props.children) {
      return React.cloneElement(
        node as React.ReactElement<{ children?: React.ReactNode }>,
        {},
        React.Children.map(node.props.children, injectCitations),
      )
    }
    return node
  }

  const wrap = (Tag: keyof React.JSX.IntrinsicElements) =>
    ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) =>
      <Tag {...(props as object)}>{React.Children.map(children, injectCitations)}</Tag>

  const components = {
    p: wrap('p'), li: wrap('li'),
    h1: wrap('h1'), h2: wrap('h2'), h3: wrap('h3'), h4: wrap('h4'),
    td: wrap('td'), th: wrap('th'),
  }

  return <ReactMarkdown components={components}>{content}</ReactMarkdown>
}

function SourcesPanel({ sources, onOpen }: { sources: Source[]; onOpen: (src: Source) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
      >
        <BookOpen className="w-3.5 h-3.5" />
        {sources.length} source{sources.length > 1 ? 's' : ''} referenced
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {sources.map((src, i) => {
            const isClickable = src.source_type === 'newsletter' || !!src.file_url
            return (
              <div key={i} className={`bg-gray-50 border border-gray-200 rounded-lg p-3 ${isClickable ? 'hover:border-indigo-300 hover:bg-indigo-50 transition-colors' : ''}`}>
                <div className="flex items-center justify-between mb-1 gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {src.source_type === 'newsletter'
                      ? <Newspaper className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      : <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    }
                    {isClickable ? (
                      <button
                        onClick={() => onOpen(src)}
                        className="text-xs font-medium text-indigo-600 hover:underline text-left truncate"
                      >
                        {src.document_name}
                      </button>
                    ) : (
                      <span className="text-xs font-medium text-gray-700 truncate">{src.document_name}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">
                    {Math.round(src.similarity * 100)}% match
                  </span>
                </div>
                <p className="text-xs text-gray-500 line-clamp-3 leading-relaxed">{src.content}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
