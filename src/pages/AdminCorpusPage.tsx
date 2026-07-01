import { useState, useCallback } from 'react'
import { Database, Search, Zap, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, Clock, XCircle, FileText, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

type DocRow = {
  id: string
  name: string
  status: string
  chunk_count: number | null
  file_size: number | null
  file_type: string | null
  created_at: string
  processing_error: string | null
  owner_email: string
}

type Chunk = {
  id: string
  chunk_index: number
  page_hint: string | null
  content: string
  document_id?: string
  documents?: { name: string; status: string }
}

type RetrievalHit = {
  id: string
  document_id: string
  document_name: string
  chunk_index: number
  content: string
  similarity: number
  rrf_score: number
  rank: number
  page_hint: string | null
  hyde_text?: string
}

type Tab = 'documents' | 'search' | 'retrieval'

function callApi(session: { access_token: string }, body: object) {
  return fetch('/.netlify/functions/corpus-inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  }).then(r => r.json())
}

export default function AdminCorpusPage() {
  const { session } = useAuth()
  const [tab, setTab] = useState<Tab>('documents')

  // Documents tab
  const [docs, setDocs] = useState<DocRow[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [docsLoaded, setDocsLoaded] = useState(false)
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null)
  const [chunks, setChunks] = useState<Record<string, Chunk[]>>({})
  const [chunksLoading, setChunksLoading] = useState<string | null>(null)

  // Search tab
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Chunk[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  // Retrieval tab
  const [retrievalQuery, setRetrievalQuery] = useState('')
  const [retrievalResults, setRetrievalResults] = useState<RetrievalHit[]>([])
  const [retrievalLoading, setRetrievalLoading] = useState(false)
  const [retrievalError, setRetrievalError] = useState('')

  // Search tab error
  const [searchError, setSearchError] = useState('')

  const loadDocs = useCallback(async () => {
    if (!session) return
    setDocsLoading(true)
    const data = await callApi(session, { action: 'list_documents' })
    setDocs(Array.isArray(data) ? data : [])
    setDocsLoaded(true)
    setDocsLoading(false)
  }, [session])

  const toggleDoc = async (docId: string) => {
    if (expandedDoc === docId) { setExpandedDoc(null); return }
    setExpandedDoc(docId)
    if (chunks[docId]) return
    setChunksLoading(docId)
    const data = await callApi(session!, { action: 'list_chunks', document_id: docId })
    setChunks(c => ({ ...c, [docId]: Array.isArray(data) ? data : [] }))
    setChunksLoading(null)
  }

  const runSearch = async () => {
    if (!searchQuery.trim() || !session) return
    setSearchLoading(true)
    setSearchError('')
    const data = await callApi(session, { action: 'search_chunks', query: searchQuery })
    if (Array.isArray(data)) {
      setSearchResults(data)
    } else {
      setSearchError(data?.error ?? 'Unknown error')
      setSearchResults([])
    }
    setSearchLoading(false)
  }

  const runRetrieval = async () => {
    if (!retrievalQuery.trim() || !session) return
    setRetrievalLoading(true)
    setRetrievalError('')
    setRetrievalResults([])
    const data = await callApi(session, { action: 'test_retrieval', query: retrievalQuery, match_count: 10 })
    if (Array.isArray(data)) {
      setRetrievalResults(data)
    } else {
      setRetrievalError(data?.error ?? 'Unknown error — check that migration 018 has been run in Supabase')
    }
    setRetrievalLoading(false)
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'documents', label: 'Documents', icon: <Database className="w-4 h-4" /> },
    { id: 'search',    label: 'Search chunks', icon: <Search className="w-4 h-4" /> },
    { id: 'retrieval', label: 'Test retrieval', icon: <Zap className="w-4 h-4" /> },
  ]

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Database className="w-5 h-5 text-indigo-600" />
          <h1 className="text-2xl font-bold text-gray-900">Corpus Inspector</h1>
        </div>
        <p className="text-sm text-gray-500">Inspect ingested documents, search chunk content, and simulate retrieval queries.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); if (t.id === 'documents' && !docsLoaded) loadDocs() }}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── Documents tab ──────────────────────────────────────────────── */}
      {tab === 'documents' && (
        <div>
          <div className="flex justify-end mb-4">
            <button
              onClick={loadDocs}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${docsLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          {docsLoading && !docsLoaded && (
            <div className="text-sm text-gray-400 text-center py-12">Loading documents…</div>
          )}

          {docsLoaded && docs.length === 0 && (
            <div className="text-sm text-gray-400 text-center py-12">No documents found.</div>
          )}

          {docs.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
              {docs.map(doc => {
                const isOpen = expandedDoc === doc.id
                return (
                  <div key={doc.id}>
                    <button
                      onClick={() => toggleDoc(doc.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors"
                    >
                      {isOpen
                        ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                        : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                      }
                      <StatusIcon status={doc.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{doc.name}</p>
                        <p className="text-xs text-gray-400">
                          {doc.owner_email} · {new Date(doc.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                          {doc.file_size ? ` · ${(doc.file_size / 1024).toFixed(0)} KB` : ''}
                        </p>
                        {doc.status === 'error' && doc.processing_error && (
                          <p className="text-xs text-red-500 mt-0.5 truncate">{doc.processing_error}</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right ml-4">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge(doc.status)}`}>
                          {doc.status}
                        </span>
                        {doc.chunk_count != null && (
                          <p className="text-xs text-gray-400 mt-0.5">{doc.chunk_count} chunks</p>
                        )}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="bg-gray-50 border-t border-gray-100 px-4 py-3">
                        {chunksLoading === doc.id && (
                          <p className="text-xs text-gray-400">Loading chunks…</p>
                        )}
                        {chunks[doc.id] && chunks[doc.id].length === 0 && (
                          <p className="text-xs text-gray-400 italic">No chunks found for this document.</p>
                        )}
                        {chunks[doc.id] && chunks[doc.id].length > 0 && (
                          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                            {chunks[doc.id].map(chunk => (
                              <ChunkCard key={chunk.id} chunk={chunk} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Search tab ─────────────────────────────────────────────────── */}
      {tab === 'search' && (
        <div>
          <div className="flex gap-2 mb-5">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runSearch()}
              placeholder='Search chunk content, e.g. "SUSAR" or "Article 42" or "Annex 1"'
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              onClick={runSearch}
              disabled={searchLoading || !searchQuery.trim()}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {searchLoading ? 'Searching…' : 'Search'}
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 mb-3">{searchResults.length} matching chunk{searchResults.length !== 1 ? 's' : ''}</p>
              {searchResults.map(chunk => (
                <ChunkCard
                  key={chunk.id}
                  chunk={chunk}
                  label={typeof chunk.documents === 'object' && chunk.documents !== null ? (chunk.documents as { name: string }).name : undefined}
                  highlight={searchQuery}
                />
              ))}
            </div>
          )}

          {searchError && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{searchError}
            </div>
          )}
          {!searchLoading && !searchError && searchResults.length === 0 && searchQuery && (
            <div className="text-center py-10 text-sm text-gray-400">
              No chunks matched <span className="font-medium text-gray-600">"{searchQuery}"</span>
            </div>
          )}
        </div>
      )}

      {/* ── Test retrieval tab ─────────────────────────────────────────── */}
      {tab === 'retrieval' && (
        <div>
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 mb-5 text-xs text-indigo-700">
            Embeds your query with <strong>text-embedding-3-small</strong> and runs cosine similarity against all indexed chunks. Results show what the AI would actually retrieve for this query.
          </div>
          <div className="flex gap-2 mb-5">
            <input
              type="text"
              value={retrievalQuery}
              onChange={e => setRetrievalQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runRetrieval()}
              placeholder='Try: "difference between SAE and SUSAR" or "SUSAR reporting timelines EU"'
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              onClick={runRetrieval}
              disabled={retrievalLoading || !retrievalQuery.trim()}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {retrievalLoading ? 'Running…' : 'Run'}
            </button>
          </div>

          {retrievalResults.length > 0 && (
            <div className="space-y-3">
              {retrievalResults[0]?.hyde_text && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700">
                  <span className="font-semibold">HyDE excerpt used for embedding: </span>
                  {retrievalResults[0].hyde_text}
                </div>
              )}
              <p className="text-xs text-gray-400">
                Top {retrievalResults.length} chunks · scores normalized (rank #1 = 100%)
              </p>
              {retrievalResults.map((hit, i) => (
                <div key={hit.id} className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-gray-400 w-5 text-right shrink-0">#{i + 1}</span>
                      <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="text-xs font-medium text-gray-700 truncate">{hit.document_name}</span>
                      <span className="text-xs text-gray-400 shrink-0">· chunk {hit.chunk_index}</span>
                      {hit.page_hint && <span className="text-xs text-gray-400 shrink-0">· {hit.page_hint}</span>}
                    </div>
                    <SimilarityBadge score={hit.similarity} />
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{hit.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {retrievalError && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Retrieval failed</p>
                <p className="mt-0.5 font-mono">{retrievalError}</p>
                <p className="mt-1 text-red-500">Make sure migration 018 has been run in the Supabase SQL editor.</p>
              </div>
            </div>
          )}
          {!retrievalLoading && !retrievalError && retrievalResults.length === 0 && retrievalQuery && (
            <div className="text-center py-10 text-sm text-gray-400">No results — the query returned no chunks above the similarity floor.</div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'ready')      return <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
  if (status === 'error')      return <XCircle className="w-4 h-4 text-red-400 shrink-0" />
  if (status === 'processing') return <Clock className="w-4 h-4 text-amber-400 shrink-0" />
  return <AlertTriangle className="w-4 h-4 text-gray-300 shrink-0" />
}

function statusBadge(status: string) {
  if (status === 'ready')      return 'bg-green-100 text-green-700'
  if (status === 'error')      return 'bg-red-100 text-red-600'
  if (status === 'processing') return 'bg-amber-100 text-amber-700'
  return 'bg-gray-100 text-gray-500'
}

function SimilarityBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color =
    pct >= 70 ? 'bg-green-100 text-green-700' :
    pct >= 50 ? 'bg-amber-100 text-amber-700' :
    'bg-red-100 text-red-600'
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${color}`}>
      {pct}% match
    </span>
  )
}

function ChunkCard({ chunk, label, highlight }: { chunk: Chunk; label?: string; highlight?: string }) {
  const [expanded, setExpanded] = useState(false)
  const preview = chunk.content.length > 300 && !expanded
    ? chunk.content.slice(0, 300) + '…'
    : chunk.content

  const highlightText = (text: string, term: string) => {
    if (!term) return text
    const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === term.toLowerCase()
        ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5">{part}</mark>
        : part
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100">
        <span className="text-xs text-gray-400 font-mono">#{chunk.chunk_index}</span>
        {chunk.page_hint && <span className="text-xs text-gray-400">{chunk.page_hint}</span>}
        {label && <span className="text-xs font-medium text-indigo-600 truncate">{label}</span>}
        <span className="ml-auto text-xs text-gray-300">{chunk.content.length} chars</span>
      </div>
      <div className="px-3 py-2">
        <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
          {highlight ? highlightText(preview, highlight) : preview}
        </p>
        {chunk.content.length > 300 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-indigo-500 hover:text-indigo-700 mt-1"
          >
            {expanded ? 'Show less' : 'Show full chunk'}
          </button>
        )}
      </div>
    </div>
  )
}
