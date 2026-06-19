import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  FileText,
  MessageSquare,
  Rocket,
  LogOut,
  ChevronRight,
  Newspaper,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const nav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/documents', icon: FileText, label: 'Documents' },
  { to: '/query', icon: MessageSquare, label: 'Intelligence Query' },
  { to: '/news', icon: Newspaper, label: 'News' },
]

const adminNav = [
  { to: '/admin/news', icon: ShieldCheck, label: 'News admin' },
  { to: '/admin/users', icon: Users, label: 'Users' },
]

export default function Layout() {
  const { user, isAdmin, signOut } = useAuth()

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 flex flex-col shrink-0" style={{ backgroundColor: '#1e1b4b' }}>

        {/* Brand */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-indigo-800">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#4F46E5' }}>
            <Rocket className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-none tracking-tight">AcceleraQA</p>
            <p className="text-indigo-300 text-xs mt-0.5">Regulatory Intelligence</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-white'
                    : 'text-indigo-200 hover:text-white'
                }`
              }
              style={({ isActive }) => isActive ? { backgroundColor: '#4F46E5' } : undefined}
            >
              {({ isActive }) => (
                <>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{label}</span>
                  {isActive && <ChevronRight className="w-3 h-3 opacity-60" />}
                </>
              )}
            </NavLink>
          ))}

          {isAdmin && (
            <div className="pt-3 mt-3 border-t border-indigo-800">
              <p className="text-indigo-400 text-xs px-3 mb-1.5 uppercase tracking-wide font-medium">Admin</p>
              {adminNav.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'text-white'
                        : 'text-indigo-200 hover:text-white'
                    }`
                  }
                  style={({ isActive }) => isActive ? { backgroundColor: '#4F46E5' } : undefined}
                >
                  {({ isActive }) => (
                    <>
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1">{label}</span>
                      {isActive && <ChevronRight className="w-3 h-3 opacity-60" />}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          )}
        </nav>

        {/* User */}
        <div className="px-3 pb-4 border-t border-indigo-800 pt-3">
          <div className="px-3 py-2 mb-1">
            <p className="text-indigo-200 text-xs truncate">{user?.email}</p>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-indigo-300 hover:text-white rounded-lg text-sm font-medium transition-colors hover:bg-indigo-800"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
