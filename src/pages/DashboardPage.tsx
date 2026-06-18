import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FileText, MessageSquare, CheckCircle, Clock, AlertTriangle, ArrowRight } from 'lucide-react'
import { supabase, type Document } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function DashboardPage() {
  const { user } = useAuth()
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    supabase
      .from('documents')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setDocs(data ?? [])
        setLoading(false)
      })
  }, [user])

  const ready = docs.filter(d => d.status === 'ready').length
  const processing = docs.filter(d => d.status === 'processing').length
  const errored = docs.filter(d => d.status === 'error').length
  const totalChunks = docs.reduce((sum, d) => sum + (d.chunk_count ?? 0), 0)

  const greeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const firstName = user?.user_metadata?.full_name?.split(' ')[0] ?? 'there'

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {greeting()}, {firstName}
        </h1>
        <p className="text-gray-500 mt-1">
          Your regulatory intelligence workspace is ready.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<FileText className="w-5 h-5 text-blue-600" />}
          label="Total Documents"
          value={docs.length}
          bg="bg-blue-50"
        />
        <StatCard
          icon={<CheckCircle className="w-5 h-5 text-green-600" />}
          label="Ready to Query"
          value={ready}
          bg="bg-green-50"
        />
        <StatCard
          icon={<Clock className="w-5 h-5 text-amber-600" />}
          label="Processing"
          value={processing}
          bg="bg-amber-50"
        />
        <StatCard
          icon={<MessageSquare className="w-5 h-5 text-purple-600" />}
          label="Knowledge Chunks"
          value={totalChunks.toLocaleString()}
          bg="bg-purple-50"
        />
      </div>

      {/* Quick actions */}
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        <QuickAction
          to="/documents"
          icon={<FileText className="w-6 h-6 text-blue-700" />}
          title="Upload Documents"
          description="Add FDA guidances, ICH guidelines, SOPs, or any regulatory document to your knowledge base."
          bg="bg-blue-50 border-blue-200"
          textColor="text-blue-700"
        />
        <QuickAction
          to="/query"
          icon={<MessageSquare className="w-6 h-6 text-purple-700" />}
          title="Intelligence Query"
          description="Ask regulatory questions and get AI-powered answers grounded in your uploaded documents."
          bg="bg-purple-50 border-purple-200"
          textColor="text-purple-700"
        />
      </div>

      {/* Recent documents */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Documents</h2>
          <Link
            to="/documents"
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {loading ? (
          <div className="text-gray-400 text-sm">Loading…</div>
        ) : docs.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
            <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No documents yet.</p>
            <Link
              to="/documents"
              className="mt-3 inline-block text-sm text-blue-600 hover:underline"
            >
              Upload your first document →
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {docs.slice(0, 5).map(doc => (
              <div key={doc.id} className="flex items-center gap-4 px-4 py-3">
                <FileText className="w-5 h-5 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{doc.name}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(doc.created_at).toLocaleDateString()} ·{' '}
                    {doc.chunk_count > 0 ? `${doc.chunk_count} chunks` : '—'}
                  </p>
                </div>
                <StatusBadge status={doc.status} />
              </div>
            ))}
          </div>
        )}

        {errored > 0 && (
          <div className="mt-3 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {errored} document{errored > 1 ? 's' : ''} failed to process. Try re-uploading.
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({
  icon, label, value, bg,
}: {
  icon: ReactNode
  label: string
  value: number | string
  bg: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className={`inline-flex p-2 rounded-lg ${bg} mb-3`}>{icon}</div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

function QuickAction({
  to, icon, title, description, bg, textColor,
}: {
  to: string
  icon: ReactNode
  title: string
  description: string
  bg: string
  textColor: string
}) {
  return (
    <Link
      to={to}
      className={`block p-5 rounded-xl border ${bg} hover:shadow-md transition-shadow`}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">{icon}</div>
        <div>
          <p className={`font-semibold ${textColor}`}>{title}</p>
          <p className="text-sm text-gray-600 mt-1">{description}</p>
        </div>
      </div>
    </Link>
  )
}

function StatusBadge({ status }: { status: Document['status'] }) {
  const map = {
    ready: 'bg-green-100 text-green-700',
    processing: 'bg-amber-100 text-amber-700',
    error: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status]}`}>
      {status}
    </span>
  )
}
