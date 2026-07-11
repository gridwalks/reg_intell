import { type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import AuthPage from './pages/AuthPage'
import DashboardPage from './pages/DashboardPage'
import DocumentsPage from './pages/DocumentsPage'
import ChatPage from './pages/ChatPage'
import AdminUsersPage from './pages/AdminUsersPage'
import AdminCorpusPage from './pages/AdminCorpusPage'
import PendingApprovalPage from './pages/PendingApprovalPage'
import UpdatePasswordPage from './pages/UpdatePasswordPage'
import AccountPage from './pages/AccountPage'

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, profile, loading } = useAuth()

  if (loading) return <Spinner />
  if (!user) return <Navigate to="/auth" replace />
  if (!profile) return <>{children}</>
  if (profile.status === 'pending')  return <PendingApprovalPage />
  if (profile.status === 'rejected') return <PendingApprovalPage rejected />

  return <>{children}</>
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin, loading, profile } = useAuth()

  if (loading) return <Spinner />
  if (!profile) return <Spinner />
  if (!isAdmin) return <Navigate to="/query" replace />

  return <>{children}</>
}

function PlatformRoute({ children }: { children: ReactNode }) {
  const { tier, loading, profile } = useAuth()

  if (loading) return <Spinner />
  if (!profile) return <Spinner />
  // Non-paying tiers land on billing instead — there's no free in-app
  // destination left now that News lives on Substack.
  if (tier !== 'platform') return <Navigate to="/account" replace />

  return <>{children}</>
}

function Spinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  const { user, loading, needsPasswordReset } = useAuth()

  if (loading) return <Spinner />

  // Recovery link clicked — show password update form before anything else
  if (needsPasswordReset) return <UpdatePasswordPage />

  return (
    <Routes>
      <Route path="/auth" element={user ? <Navigate to="/query" replace /> : <AuthPage />} />

      {/* Protected app shell */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/query" replace />} />

        {/* Platform tier only */}
        <Route path="/query" element={<PlatformRoute><ChatPage /></PlatformRoute>} />

        {/* Admin only */}
        <Route path="/dashboard" element={<AdminRoute><DashboardPage /></AdminRoute>} />
        <Route path="/documents" element={<AdminRoute><DocumentsPage /></AdminRoute>} />
        <Route path="/admin/users"   element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
        <Route path="/admin/corpus" element={<AdminRoute><AdminCorpusPage /></AdminRoute>} />

        {/* All approved users */}
        <Route path="/account" element={<AccountPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/query" replace />} />
    </Routes>
  )
}
