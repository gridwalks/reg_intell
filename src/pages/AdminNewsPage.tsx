import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  CheckCircle, Trash2, Edit3, Eye, AlertTriangle,
  ChevronDown, ChevronUp, ExternalLink, RefreshCw, Play,
  Plus, Save, X, Rss, Globe,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

type Draft = {
  id: string
  draft_date: string
  status: 'pending_approval' | 'published' | 'discarded'
  intro_text: string | null
  sponsor_section: string | null
  vendor_section: string | null
  article_count: number | null
  created_at: string
}

type Article = {
  id: string
  title: string
  url: string
  ai_summary: string | null
  ai_impact_assessment: string | null
  ai_audience_tag: string | null
  ai_relevance_score: number | null
  status: string
  news_sources: { name: string } | null
}

type Source = {
  id: string
  name: string
  homepage_url: string
  feed_url: string | null
  tier: number
  access_status: 'active' | 'manual_review_required' | 'paywalled' | 'inactive'
  full_fetch_needed: boolean
  notes: string | null
  last_fetched_at: string | null
  created_at: string
}

type SourceDraft = Omit<Source, 'id' | 'last_fetched_at' | 'created_at'>

const BLANK_SOURCE: SourceDraft = {
  name: '',
  homepage_url: '',
  feed_url: '',
  tier: 1,
  access_status: 'active',
  full_fetch_needed: false,
  notes: '',
}

type Tab = 'newsletter' | 'sources'

export default function AdminNewsPage() {
  const { session } = useAuth()
  const [tab, setTab] = useState<Tab>('newsletter')

  // Newsletter state
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null)
  const [editing, setEditing] = useState(false)
  const [showArticles, setShowArticles] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [triggering, setTriggering] = useState(false)
  const [triggerCountdown, setTriggerCountdown] = useState(0)
  const formRef = useRef<{ intro: string; sponsor: string; vendor: string } | null>(null)

  // Sources state
  const [sources, setSources] = useState<Source[]>([])
  const [sourceMsg, setSourceMsg] = useState('')
  const [editingSourceId, setEditingSourceId] = useState<string | 'new' | null>(null)
  const [sourceDraft, setSourceDraft] = useState<SourceDraft>(BLANK_SOURCE)
  const [sourceSaving, setSourceSaving] = useState(false)

  useEffect(() => { loadDrafts(); loadSources() }, [])

  // ── Pipeline trigger ────────────────────────────────────────────────────────

  const triggerPipeline = async () => {
    if (!session || triggering) return
    setTriggering(true)
    setMsg('')
    try {
      await fetch('/.netlify/functions/trigger-newsletter-background', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      let elapsed = 0
      const POLL_INTERVAL = 15
      const MAX_WAIT = 180
      setTriggerCountdown(MAX_WAIT - elapsed)
      const interval = setInterval(async () => {
        elapsed += POLL_INTERVAL
        setTriggerCountdown(MAX_WAIT - elapsed)
        await loadDrafts()
        if (elapsed >= MAX_WAIT) {
          clearInterval(interval)
          setTriggering(false)
          setTriggerCountdown(0)
          setMsg('Pipeline complete. Refresh if draft is not visible.')
        }
      }, POLL_INTERVAL * 1000)
    } catch {
      setMsg('Failed to trigger pipeline.')
      setTriggering(false)
    }
  }

  // ── Newsletter ops ──────────────────────────────────────────────────────────

  const loadDrafts = async () => {
    const { data } = await supabase
      .from('newsletter_drafts')
      .select('*')
      .order('draft_date', { ascending: false })
      .limit(30)
    setDrafts(data ?? [])
    if (!selectedDraft && data && data.length > 0) selectDraft(data[0])
  }

  const loadSources = async () => {
    const { data } = await supabase.from('news_sources').select('*').order('tier').order('name')
    setSources(data ?? [])
  }

  const selectDraft = async (draft: Draft) => {
    setSelectedDraft(draft)
    setEditing(false)
    setShowArticles(false)
    formRef.current = {
      intro: draft.intro_text ?? '',
      sponsor: draft.sponsor_section ?? '',
      vendor: draft.vendor_section ?? '',
    }
    const { data } = await supabase
      .from('newsletter_draft_articles')
      .select('article_id, news_articles(id, title, url, ai_summary, ai_impact_assessment, ai_audience_tag, ai_relevance_score, status, news_sources(name))')
      .eq('draft_id', draft.id)
    setArticles((data ?? []).map(r => r.news_articles as unknown as Article))
  }

  const saveChanges = async () => {
    if (!selectedDraft || !formRef.current) return
    setSaving(true)
    const { error } = await supabase
      .from('newsletter_drafts')
      .update({
        intro_text: formRef.current.intro,
        sponsor_section: formRef.current.sponsor,
        vendor_section: formRef.current.vendor,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selectedDraft.id)
    if (error) { setMsg('Save failed: ' + error.message) }
    else {
      setSelectedDraft(d => d ? {
        ...d,
        intro_text: formRef.current!.intro,
        sponsor_section: formRef.current!.sponsor,
        vendor_section: formRef.current!.vendor,
      } : d)
      setMsg('Saved')
      setEditing(false)
    }
    setSaving(false)
    setTimeout(() => setMsg(''), 3000)
  }

  const approve = async () => {
    if (!selectedDraft) return
    if (!confirm('Approve and publish this newsletter?')) return
    setSaving(true)
    await saveChanges()
    const { error } = await supabase
      .from('newsletter_drafts')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', selectedDraft.id)
    if (error) setMsg('Publish failed: ' + error.message)
    else { setMsg('Published'); loadDrafts() }
    setSaving(false)
    setTimeout(() => setMsg(''), 3000)
  }

  const discard = async () => {
    if (!selectedDraft) return
    if (!confirm("Discard this draft? It won't be published.")) return
    await supabase
      .from('newsletter_drafts')
      .update({ status: 'discarded' })
      .eq('id', selectedDraft.id)
    setMsg('Discarded')
    loadDrafts()
    setTimeout(() => setMsg(''), 3000)
  }

  // ── Source ops ──────────────────────────────────────────────────────────────

  const startAddSource = () => {
    setSourceDraft(BLANK_SOURCE)
    setEditingSourceId('new')
    setSourceMsg('')
  }

  const startEditSource = (s: Source) => {
    setSourceDraft({
      name: s.name,
      homepage_url: s.homepage_url,
      feed_url: s.feed_url ?? '',
      tier: s.tier,
      access_status: s.access_status,
      full_fetch_needed: s.full_fetch_needed,
      notes: s.notes ?? '',
    })
    setEditingSourceId(s.id)
    setSourceMsg('')
  }

  const cancelEditSource = () => {
    setEditingSourceId(null)
    setSourceDraft(BLANK_SOURCE)
  }

  const saveSource = async () => {
    if (!sourceDraft.name.trim() || !sourceDraft.homepage_url.trim()) {
      setSourceMsg('Name and homepage URL are required.')
      return
    }
    setSourceSaving(true)
    const payload = {
      name: sourceDraft.name.trim(),
      homepage_url: sourceDraft.homepage_url.trim(),
      feed_url: sourceDraft.feed_url?.trim() || null,
      tier: sourceDraft.tier,
      access_status: sourceDraft.access_status,
      full_fetch_needed: sourceDraft.full_fetch_needed,
      notes: sourceDraft.notes?.trim() || null,
    }
    let error
    if (editingSourceId === 'new') {
      ;({ error } = await supabase.from('news_sources').insert(payload))
    } else {
      ;({ error } = await supabase.from('news_sources').update(payload).eq('id', editingSourceId))
    }
    if (error) {
      setSourceMsg('Save failed: ' + error.message)
    } else {
      setSourceMsg(editingSourceId === 'new' ? 'Source added.' : 'Source updated.')
      setEditingSourceId(null)
      await loadSources()
      setTimeout(() => setSourceMsg(''), 3000)
    }
    setSourceSaving(false)
  }

  const deleteSource = async (s: Source) => {
    if (!confirm(`Delete "${s.name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('news_sources').delete().eq('id', s.id)
    if (error) setSourceMsg('Delete failed: ' + error.message)
    else { await loadSources(); setSourceMsg('Source deleted.'); setTimeout(() => setSourceMsg(''), 3000) }
  }

  const toggleStatus = async (s: Source) => {
    const next = s.access_status === 'active' ? 'inactive' : 'active'
    await supabase.from('news_sources').update({ access_status: next }).eq('id', s.id)
    await loadSources()
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const manualReviewSources = sources.filter(s => s.access_status === 'manual_review_required')
  const paywalledSources    = sources.filter(s => s.access_status === 'paywalled')
  const activeSources       = sources.filter(s => s.access_status === 'active')

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">News admin</h1>
          <p className="text-gray-500 text-sm mt-1">
            Review newsletter drafts and manage the sources the pipeline ingests from.
          </p>
        </div>
        <button
          onClick={triggerPipeline}
          disabled={triggering}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {triggering
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <Play className="w-4 h-4" />}
          {triggering ? `Pipeline running... ${triggerCountdown > 0 ? `(${triggerCountdown}s)` : ''}` : 'Run pipeline now'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['newsletter', 'sources'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize -mb-px border-b-2 transition-colors ${
              tab === t
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'newsletter' ? 'Newsletter drafts' : 'Sources'}
          </button>
        ))}
      </div>

      {/* ── Newsletter tab ──────────────────────────────────────────────────── */}
      {tab === 'newsletter' && (
        <div className="grid grid-cols-[240px_1fr] gap-6">
          {/* Left: Draft list */}
          <aside className="space-y-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2 mb-2">Drafts</p>
            {drafts.length === 0 && (
              <p className="text-sm text-gray-400 px-2">No drafts yet.</p>
            )}
            {drafts.map(d => (
              <button
                key={d.id}
                onClick={() => selectDraft(d)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  selectedDraft?.id === d.id
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>
                    {new Date(d.draft_date + 'T12:00:00Z').toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric',
                    })}
                  </span>
                  <StatusDot status={d.status} />
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{d.article_count ?? 0} articles</p>
              </button>
            ))}
          </aside>

          {/* Right: Editor */}
          <div className="min-w-0">
            {!selectedDraft ? (
              <div className="text-center py-16 text-gray-400 text-sm">Select a draft to review</div>
            ) : (
              <div className="space-y-5">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {new Date(selectedDraft.draft_date + 'T12:00:00Z').toLocaleDateString('en-US', {
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </h2>
                    <p className="text-sm text-gray-400 mt-0.5">
                      {selectedDraft.article_count ?? 0} articles included
                      {selectedDraft.status !== 'pending_approval' && (
                        <span className={`ml-2 font-medium ${
                          selectedDraft.status === 'published' ? 'text-green-600' : 'text-gray-400'
                        }`}>
                          {selectedDraft.status}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {msg && <span className="text-sm text-green-600 font-medium">{msg}</span>}
                    {selectedDraft.status === 'pending_approval' && (
                      <>
                        <button
                          onClick={() => setEditing(e => !e)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                        >
                          {editing ? <Eye className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
                          {editing ? 'Preview' : 'Edit'}
                        </button>
                        {editing && (
                          <button
                            onClick={saveChanges}
                            disabled={saving}
                            className="px-3 py-1.5 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                        )}
                        <button
                          onClick={approve}
                          disabled={saving}
                          className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium disabled:opacity-50"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          Approve and publish
                        </button>
                        <button
                          onClick={discard}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Discard
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <DraftSection
                  label="Intro"
                  value={selectedDraft.intro_text ?? ''}
                  editing={editing}
                  onChange={v => { if (formRef.current) formRef.current.intro = v }}
                  plain
                />
                <DraftSection
                  label="Sponsor impact"
                  value={selectedDraft.sponsor_section ?? ''}
                  editing={editing}
                  onChange={v => { if (formRef.current) formRef.current.sponsor = v }}
                />
                <DraftSection
                  label="Vendor and eClinical impact"
                  value={selectedDraft.vendor_section ?? ''}
                  editing={editing}
                  onChange={v => { if (formRef.current) formRef.current.vendor = v }}
                />

                {articles.length > 0 && (
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setShowArticles(s => !s)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    >
                      <span>Included articles ({articles.length})</span>
                      {showArticles ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    {showArticles && (
                      <div className="divide-y divide-gray-100">
                        {articles.map(a => (
                          <div key={a.id} className="px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400">{a.news_sources?.name}</span>
                                  <AudienceTag tag={a.ai_audience_tag} />
                                  {a.ai_relevance_score != null && (
                                    <span className="text-xs font-medium text-blue-600">{a.ai_relevance_score}/10</span>
                                  )}
                                </div>
                                <p className="text-sm font-medium text-gray-900 mt-0.5 truncate">{a.title}</p>
                                {a.ai_summary && <p className="text-xs text-gray-500 mt-1">{a.ai_summary}</p>}
                              </div>
                              <a href={a.url} target="_blank" rel="noopener noreferrer" className="shrink-0 mt-1">
                                <ExternalLink className="w-3.5 h-3.5 text-gray-400 hover:text-blue-500" />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Sources status panels (compact, below editor) */}
            {(manualReviewSources.length > 0 || paywalledSources.length > 0) && (
              <div className="mt-8 border border-amber-200 bg-amber-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <p className="text-sm font-semibold text-amber-800">Sources requiring manual review</p>
                </div>
                {manualReviewSources.map(s => (
                  <div key={s.id} className="mb-2">
                    <a href={s.homepage_url} target="_blank" rel="noopener noreferrer"
                      className="text-sm font-medium text-blue-700 hover:underline flex items-center gap-1">
                      {s.name} <ExternalLink className="w-3 h-3" />
                    </a>
                    {s.notes && <p className="text-xs text-amber-700 mt-0.5">{s.notes}</p>}
                  </div>
                ))}
                {paywalledSources.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-amber-700 mt-3 mb-1">Paywalled (no auto-ingestion)</p>
                    <p className="text-xs text-amber-700">{paywalledSources.map(s => s.name).join(', ')}</p>
                  </>
                )}
              </div>
            )}

            <div className="mt-4">
              <button onClick={loadSources} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600">
                <RefreshCw className="w-3 h-3" /> Refresh source status
              </button>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {activeSources.map(s => (
                  <div key={s.id} className="flex items-center justify-between text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
                    <span className="truncate">{s.name}</span>
                    <span className="shrink-0 ml-2 text-gray-400">
                      {s.last_fetched_at
                        ? new Date(s.last_fetched_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                        : 'never'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Sources tab ─────────────────────────────────────────────────────── */}
      {tab === 'sources' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              {sources.length} sources configured —{' '}
              {activeSources.length} active, {sources.filter(s => s.access_status === 'inactive').length} inactive
            </p>
            <div className="flex items-center gap-3">
              {sourceMsg && (
                <span className="text-sm text-green-600 font-medium">{sourceMsg}</span>
              )}
              {editingSourceId === null && (
                <button
                  onClick={startAddSource}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
                >
                  <Plus className="w-4 h-4" /> Add source
                </button>
              )}
            </div>
          </div>

          {/* Add / edit form */}
          {editingSourceId !== null && (
            <div className="mb-6 border border-blue-200 bg-blue-50 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-blue-900 mb-4">
                {editingSourceId === 'new' ? 'Add new source' : 'Edit source'}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Name *</span>
                  <input
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
                    value={sourceDraft.name}
                    onChange={e => setSourceDraft(d => ({ ...d, name: e.target.value }))}
                    placeholder="Fierce Pharma"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Homepage URL *</span>
                  <input
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
                    value={sourceDraft.homepage_url}
                    onChange={e => setSourceDraft(d => ({ ...d, homepage_url: e.target.value }))}
                    placeholder="https://www.example.com"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">RSS feed URL</span>
                  <input
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
                    value={sourceDraft.feed_url ?? ''}
                    onChange={e => setSourceDraft(d => ({ ...d, feed_url: e.target.value }))}
                    placeholder="https://www.example.com/feed.xml"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">Status</span>
                    <select
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                      value={sourceDraft.access_status}
                      onChange={e => setSourceDraft(d => ({ ...d, access_status: e.target.value as Source['access_status'] }))}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="manual_review_required">Manual review</option>
                      <option value="paywalled">Paywalled</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">Tier</span>
                    <select
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                      value={sourceDraft.tier}
                      onChange={e => setSourceDraft(d => ({ ...d, tier: Number(e.target.value) }))}
                    >
                      <option value={1}>Tier 1 (primary)</option>
                      <option value={2}>Tier 2 (secondary)</option>
                    </select>
                  </label>
                </div>
                <label className="block col-span-2">
                  <span className="text-xs font-medium text-gray-600">Notes</span>
                  <input
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
                    value={sourceDraft.notes ?? ''}
                    onChange={e => setSourceDraft(d => ({ ...d, notes: e.target.value }))}
                    placeholder="Any notes about this source"
                  />
                </label>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-400"
                    checked={sourceDraft.full_fetch_needed}
                    onChange={e => setSourceDraft(d => ({ ...d, full_fetch_needed: e.target.checked }))}
                  />
                  <span className="text-sm text-gray-700">Full article fetch needed (feed provides teasers only)</span>
                </label>
              </div>
              {sourceMsg && <p className="mt-2 text-sm text-red-600">{sourceMsg}</p>}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={saveSource}
                  disabled={sourceSaving}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {sourceSaving ? 'Saving...' : editingSourceId === 'new' ? 'Add source' : 'Save changes'}
                </button>
                <button
                  onClick={cancelEditSource}
                  className="flex items-center gap-1.5 px-4 py-2 text-gray-600 border border-gray-300 text-sm rounded-lg hover:bg-gray-50"
                >
                  <X className="w-4 h-4" /> Cancel
                </button>
              </div>
            </div>
          )}

          {/* Sources table */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Source</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Feed</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last fetched</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sources.map(s => (
                  <tr key={s.id} className={`hover:bg-gray-50 ${s.access_status === 'inactive' ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-gray-900">{s.name}</span>
                            <span className="text-xs text-gray-400">T{s.tier}</span>
                          </div>
                          {s.notes && <p className="text-xs text-gray-400 mt-0.5 max-w-xs truncate">{s.notes}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={s.access_status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {s.feed_url ? (
                          <>
                            <Rss className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                            <a
                              href={s.homepage_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline"
                            >
                              {s.homepage_url.replace(/^https?:\/\//, '')}
                            </a>
                            {s.full_fetch_needed && (
                              <span className="text-xs text-gray-400">(full fetch)</span>
                            )}
                          </>
                        ) : (
                          <>
                            <Globe className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                            <a
                              href={s.homepage_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-gray-400 hover:underline"
                            >
                              no RSS
                            </a>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {s.last_fetched_at
                        ? new Date(s.last_fetched_at).toLocaleString('en-US', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })
                        : 'never'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {(s.access_status === 'active' || s.access_status === 'inactive') && (
                          <button
                            onClick={() => toggleStatus(s)}
                            className={`text-xs px-2 py-1 rounded transition-colors ${
                              s.access_status === 'active'
                                ? 'text-gray-500 hover:text-amber-700 hover:bg-amber-50'
                                : 'text-green-700 hover:bg-green-50'
                            }`}
                          >
                            {s.access_status === 'active' ? 'Disable' : 'Enable'}
                          </button>
                        )}
                        <button
                          onClick={() => startEditSource(s)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteSource(s)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function DraftSection({
  label, value, editing, onChange, plain = false,
}: {
  label: string
  value: string
  editing: boolean
  onChange: (v: string) => void
  plain?: boolean
}) {
  const [localVal, setLocalVal] = useState(value)
  useEffect(() => { setLocalVal(value) }, [value])

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
      </div>
      {editing ? (
        <textarea
          className="w-full p-4 text-sm text-gray-800 resize-y min-h-[120px] outline-none font-mono leading-relaxed"
          defaultValue={localVal}
          onChange={e => { setLocalVal(e.target.value); onChange(e.target.value) }}
          rows={plain ? 3 : 12}
        />
      ) : (
        <div className="p-4">
          {plain ? (
            <p className="text-sm text-gray-700 leading-relaxed">
              {value || <span className="text-gray-400 italic">empty</span>}
            </p>
          ) : (
            <div className="prose-chat text-sm">
              {value ? <ReactMarkdown>{value}</ReactMarkdown> : <p className="text-gray-400 italic">empty</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending_approval: 'bg-amber-400',
    published: 'bg-green-500',
    discarded: 'bg-gray-300',
  }
  return <span className={`w-2 h-2 rounded-full ${colors[status] ?? 'bg-gray-300'}`} />
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    inactive: 'bg-gray-100 text-gray-500',
    manual_review_required: 'bg-amber-100 text-amber-700',
    paywalled: 'bg-purple-100 text-purple-700',
  }
  const labels: Record<string, string> = {
    active: 'Active',
    inactive: 'Inactive',
    manual_review_required: 'Manual review',
    paywalled: 'Paywalled',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {labels[status] ?? status}
    </span>
  )
}

function AudienceTag({ tag }: { tag: string | null }) {
  if (!tag) return null
  const styles: Record<string, string> = {
    sponsor: 'bg-blue-100 text-blue-700',
    vendor: 'bg-purple-100 text-purple-700',
    both: 'bg-teal-100 text-teal-700',
    low_relevance: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${styles[tag] ?? 'bg-gray-100 text-gray-500'}`}>
      {tag.replace('_', ' ')}
    </span>
  )
}
