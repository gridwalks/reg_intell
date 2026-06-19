import { useEffect, useState } from 'react'
import {
  CheckCircle, XCircle, Shield, ShieldOff, RefreshCw, Clock,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { Profile } from '../contexts/AuthContext'

type ProfileWithActions = Profile & { actioning?: boolean }

export default function AdminUsersPage() {
  const { session, user: currentUser } = useAuth()
  const [profiles, setProfiles] = useState<ProfileWithActions[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  useEffect(() => { loadProfiles() }, [])

  const loadProfiles = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
    setProfiles(data ?? [])
    setLoading(false)
  }

  const callManageUser = async (
    action: 'approve' | 'reject' | 'toggle_admin',
    userId: string
  ) => {
    if (!session) return false
    const res = await fetch('/.netlify/functions/manage-user', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, user_id: userId }),
    })
    return res.ok
  }

  const act = async (
    action: 'approve' | 'reject' | 'toggle_admin',
    profileId: string
  ) => {
    setProfiles(p => p.map(u => u.id === profileId ? { ...u, actioning: true } : u))
    const ok = await callManageUser(action, profileId)
    if (ok) {
      await loadProfiles()
      const labels = { approve: 'Approved', reject: 'Rejected', toggle_admin: 'Updated' }
      setMsg(labels[action])
      setTimeout(() => setMsg(''), 3000)
    } else {
      setProfiles(p => p.map(u => u.id === profileId ? { ...u, actioning: false } : u))
      setMsg('Action failed — check console.')
      setTimeout(() => setMsg(''), 4000)
    }
  }

  const pending  = profiles.filter(p => p.status === 'pending')
  const approved = profiles.filter(p => p.status === 'approved')
  const rejected = profiles.filter(p => p.status === 'rejected')

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User management</h1>
          <p className="text-gray-500 text-sm mt-1">
            Approve new accounts and manage admin access.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {msg && <span className="text-sm font-medium text-green-600">{msg}</span>}
          <button
            onClick={loadProfiles}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* Pending */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              Pending approval ({pending.length})
            </h2>
            {pending.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No pending accounts.</p>
            ) : (
              <div className="border border-amber-200 bg-amber-50 rounded-xl overflow-hidden divide-y divide-amber-100">
                {pending.map(p => (
                  <UserRow
                    key={p.id}
                    profile={p}
                    isSelf={p.id === currentUser?.id}
                    onAction={act}
                    actions={['approve', 'reject']}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Approved */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              Approved ({approved.length})
            </h2>
            {approved.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No approved users.</p>
            ) : (
              <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                {approved.map(p => (
                  <UserRow
                    key={p.id}
                    profile={p}
                    isSelf={p.id === currentUser?.id}
                    onAction={act}
                    actions={['reject', 'toggle_admin']}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Rejected */}
          {rejected.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-400" />
                Rejected ({rejected.length})
              </h2>
              <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 opacity-70">
                {rejected.map(p => (
                  <UserRow
                    key={p.id}
                    profile={p}
                    isSelf={p.id === currentUser?.id}
                    onAction={act}
                    actions={['approve']}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function UserRow({
  profile,
  isSelf,
  onAction,
  actions,
}: {
  profile: ProfileWithActions
  isSelf: boolean
  onAction: (action: 'approve' | 'reject' | 'toggle_admin', id: string) => void
  actions: Array<'approve' | 'reject' | 'toggle_admin'>
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 truncate">{profile.email}</span>
          {profile.is_admin && (
            <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">admin</span>
          )}
          {isSelf && (
            <span className="text-xs text-gray-400">(you)</span>
          )}
        </div>
        {profile.full_name && (
          <p className="text-xs text-gray-500 mt-0.5">{profile.full_name}</p>
        )}
        <p className="text-xs text-gray-400 mt-0.5">
          Joined {new Date(profile.created_at).toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
          })}
          {profile.approved_at && ` · Approved ${new Date(profile.approved_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric',
          })}`}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {profile.actioning ? (
          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        ) : (
          <>
            {actions.includes('approve') && (
              <button
                onClick={() => onAction('approve', profile.id)}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
              >
                <CheckCircle className="w-3.5 h-3.5" /> Approve
              </button>
            )}
            {actions.includes('reject') && !isSelf && (
              <button
                onClick={() => onAction('reject', profile.id)}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 text-red-600 border border-red-200 hover:bg-red-50 rounded-lg"
              >
                <XCircle className="w-3.5 h-3.5" /> Reject
              </button>
            )}
            {actions.includes('toggle_admin') && !isSelf && (
              <button
                onClick={() => onAction('toggle_admin', profile.id)}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 text-gray-600 border border-gray-300 hover:bg-gray-50 rounded-lg"
                title={profile.is_admin ? 'Remove admin' : 'Make admin'}
              >
                {profile.is_admin
                  ? <><ShieldOff className="w-3.5 h-3.5" /> Remove admin</>
                  : <><Shield className="w-3.5 h-3.5" /> Make admin</>}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
