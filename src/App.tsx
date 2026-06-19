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

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/auth" replace />

  // Profile couldn't be loaded (migration not yet run, or table error) — let them in
  if (!profile) return <>{children}</>

  if (profile.status === 'pending')  return <PendingApprovalPage />
  if (profile.status === 'rejected') return <PendingApprovalPage rejected />

  return <>{children}</>
}

export default function App() {
  const { user, loading, needsPasswordReset } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Recovery link clicked — show password update form before anything else
  if (needsPasswordReset) return <UpdatePasswordPage />

  return (
    <Routes>
      <Route path="/auth" element={user ? <Navigate to="/dashboard" replace /> : <AuthPage />} />

      {/* Public news page — no auth required */}
      <Route path="/news" element={<NewsPage />} />

      {/* Protected app shell */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/query" element={<ChatPage />} />
        <Route path="/admin/news" element={<AdminNewsPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
