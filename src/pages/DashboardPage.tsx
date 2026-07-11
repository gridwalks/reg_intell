import { useEffect, useState } from 'react'
import {
  Database, HardDrive, Users, FileText, Layers,
  Newspaper, Rss, RefreshCw, AlertTriangle, CheckCircle, Clock,
  UserCheck, Bot,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

// Kept in sync by hand with MODEL_CONFIGS in netlify/functions/chat.ts —
// the frontend and the function are separate bundles, same as elsewhere
// in this codebase (e.g. profiles.tier duplicated between AuthContext and
// migrations rather than shared).
const MODELS = [
  { id: 'command-r7b-12-2024',     label: 'Command R7B',   provider: 'Cohere' },
  { id: 'command-a-plus-05-2026',  label: 'Command A+',    provider: 'Cohere' },
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', provider: 'Groq' },
]

type TableSize = { table_name: string; row_count: number; size_bytes: number }

type HealthData = {
  db_size_bytes: number | null
  storage_size_bytes: number | null
  db_size_error: string | null
  storage_size_error: string | null
  documents: { total: number; ready: number; processing: number; error: number }
  chunk_count: number
  user_count: number
  pending_users: number
  newsletter_count: number
  news_article_count: number
  table_sizes: TableSize[]
  fetched_at: string
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1_024)         return `${(bytes / 1_024).toFixed(0)} KB`
  return `${bytes} B`
}

function pct(used: number, limit: number) {
  return Math.min(100, Math.round((used / limit) * 100))
}

export default function DashboardPage() {
  const { session, user } = useAuth()
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [chatModel, setChatModel] = useState<string | null>(null)
  const [modelSaving, setModelSaving] = useState(false)
  const [modelError, setModelError] = useState('')

  const fetchChatModel = async () => {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'chat_model')
      .maybeSingle()
    setChatModel(data?.value ?? 'command-a-plus-05-2026')
  }

  const updateChatModel = async (value: string) => {
    setModelError('')
    setModelSaving(true)
    const previous = chatModel
    setChatModel(value) // optimistic
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'chat_model', value, updated_by: user?.id, updated_at: new Date().toISOString() })
    if (error) {
      setChatModel(previous)
      setModelError(error.message)
    }
    setModelSaving(false)
  }

  useEffect(() => { fetchChatModel() }, [])

  const fetchHealth = async () => {
    if (!session) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/.netlify/functions/system-health', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error(await res.text())
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load metrics')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchHealth() }, [session])

  const DB_LIMIT  = 0.5 * 1_073_741_824   // 0.5 GB free tier
  const STG_LIMIT = 1.0 * 1_073_741_824   // 1 GB free tier

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System Health</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Live Supabase usage metrics
            {data && (
              <span className="ml-2 text-gray-400">
                — last updated {new Date(data.fetched_at).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={fetchHealth}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm mb-6">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Assistant model ── */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Assistant Model</h2>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bot className="w-4 h-4 text-indigo-600" />
            <span className="text-sm font-medium text-gray-700">Model used for Intelligence Query</span>
          </div>
          {chatModel === null ? (
            <div className="text-xs text-gray-400">Loading…</div>
          ) : (
            <>
              <select
                value={chatModel}
                onChange={e => updateChatModel(e.target.value)}
                disabled={modelSaving}
                className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
              >
                {MODELS.map(m => (
                  <option key={m.id} value={m.id}>{m.provider} — {m.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-2">
                Applies to every user immediately — this isn't per-session.
              </p>
              {modelError && <p className="text-xs text-red-600 mt-1">{modelError}</p>}
            </>
          )}
        </div>
      </section>

      {loading && !data && (
        <div className="text-gray-400 text-sm">Loading metrics…</div>
      )}

      {data && (
        <div className="space-y-6">

          {/* ── Supabase plan usage ── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Plan Usage</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <UsageBar
                icon={<Database className="w-4 h-4 text-indigo-600" />}
                label="Database Size"
                used={data.db_size_bytes}
                limit={DB_LIMIT}
                limitLabel="0.5 GB free tier"
                errorMsg={data.db_size_error}
              />
              <UsageBar
                icon={<HardDrive className="w-4 h-4 text-indigo-600" />}
                label="Storage Size"
                used={data.storage_size_bytes}
                limit={STG_LIMIT}
                limitLabel="1 GB free tier"
                errorMsg={data.storage_size_error}
              />
            </div>
          </section>

          {/* ── Content counts ── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Content</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                icon={<FileText className="w-5 h-5 text-blue-600" />}
                label="Documents"
                value={data.documents.total}
                bg="bg-blue-50"
                sub={
                  <span className="flex gap-2 mt-1">
                    <span className="text-green-600">{data.documents.ready} ready</span>
                    {data.documents.processing > 0 && <span className="text-amber-600">{data.documents.processing} processing</span>}
                    {data.documents.error > 0 && <span className="text-red-600">{data.documents.error} error</span>}
                  </span>
                }
              />
              <MetricCard
                icon={<Layers className="w-5 h-5 text-purple-600" />}
                label="Knowledge Chunks"
                value={data.chunk_count.toLocaleString()}
                bg="bg-purple-50"
              />
              <MetricCard
                icon={<Newspaper className="w-5 h-5 text-teal-600" />}
                label="Newsletters Published"
                value={data.newsletter_count}
                bg="bg-teal-50"
              />
              <MetricCard
                icon={<Rss className="w-5 h-5 text-orange-600" />}
                label="News Articles Ingested"
                value={data.news_article_count.toLocaleString()}
                bg="bg-orange-50"
              />
            </div>
          </section>

          {/* ── Users ── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Users</h2>
            <div className="grid grid-cols-2 gap-4 max-w-sm">
              <MetricCard
                icon={<Users className="w-5 h-5 text-indigo-600" />}
                label="Total Users"
                value={data.user_count}
                bg="bg-indigo-50"
              />
              <MetricCard
                icon={data.pending_users > 0
                  ? <Clock className="w-5 h-5 text-amber-600" />
                  : <UserCheck className="w-5 h-5 text-green-600" />}
                label="Pending Approval"
                value={data.pending_users}
                bg={data.pending_users > 0 ? 'bg-amber-50' : 'bg-green-50'}
              />
            </div>
          </section>

          {/* ── Table sizes ── */}
          {data.table_sizes.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Table Breakdown</h2>
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Table</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Rows (est.)</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Size</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.table_sizes.map(t => (
                      <tr key={t.table_name} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{t.table_name}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-600">{Number(t.row_count).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-600">{fmtBytes(Number(t.size_bytes))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

        </div>
      )}
    </div>
  )
}

function MetricCard({ icon, label, value, bg, sub }: {
  icon: React.ReactNode
  label: string
  value: number | string
  bg: string
  sub?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className={`inline-flex p-2 rounded-lg ${bg} mb-3`}>{icon}</div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {sub && <div className="text-xs mt-1">{sub}</div>}
    </div>
  )
}

function UsageBar({ icon, label, used, limit, limitLabel, errorMsg }: {
  icon: React.ReactNode
  label: string
  used: number | null
  limit: number
  limitLabel: string
  errorMsg?: string | null
}) {
  const p = used != null ? pct(used, limit) : 0
  const color = p >= 90 ? 'bg-red-500' : p >= 70 ? 'bg-amber-500' : 'bg-indigo-500'
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-sm font-medium text-gray-700">{label}</span>
      </div>
      {used == null ? (
        <div className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
          {errorMsg
            ? <>SQL function not installed. Run migration 011 in Supabase SQL Editor.</>
            : 'Unavailable'}
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between mb-1.5">
            <span className="text-xl font-bold text-gray-900">{fmtBytes(used)}</span>
            <span className="text-xs text-gray-400">{p}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${p}%` }} />
          </div>
          <p className="text-xs text-gray-400 mt-1.5">Limit: {limitLabel}</p>
        </>
      )}
    </div>
  )
}
