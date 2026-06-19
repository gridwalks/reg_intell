import { type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import AuthPage from './pages/AuthPage'
import DashboardPage from './pages/DashboardPage'
import DocumentsPage from './pages/DocumentsPage'
import ChatPage from './pages/ChatPage'
import NewsPage from './pages/NewsPage'
import AdminNewsPage from './pages/AdminNewsPage'
import AdminUsersPage from './pages/AdminUsersPage'
import PendingApprovalPage from './pages/PendingApprovalPage'
import UpdatePasswordPage from './pages/UpdatePasswordPage'

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
  // Wait for profile to load before deciding
  if (!profile) return <Spinner />
  if (!isAdmin) return (
    <div className="flex h-full items-center justify-center py-24">
      <div className="text-center">
        <p className="text-gray-500 text-sm">You don't have permission to view this page.</p>
      </div>
    </div>
  )

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

      {/* Public news page — no auth required */}
      <Route path="/news" element={<NewsPage />} />

      {/* Protected app shell */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/query" replace />} />

        {/* Admin-only */}
        <Route path="/dashboard" element={<AdminRoute><DashboardPage /></AdminRoute>} />
        <Route path="/documents" element={<AdminRoute><DocumentsPage /></AdminRoute>} />
        <Route path="/admin/news"  element={<AdminRoute><AdminNewsPage /></AdminRoute>} />
        <Route path="/admin/users" element={<AdminRoute><AdminUsersPage /></AdminRoute>} />

        {/* All approved users */}
        <Route path="/query" element={<ChatPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/query" replace />} />
    </Routes>
  )
}
