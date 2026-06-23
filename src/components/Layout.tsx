import type React from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  FileText,
  MessageSquare,
  LogOut,
  ChevronRight,
  Newspaper,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useAuth, type Tier } from '../contexts/AuthContext'

const TIER_LABELS: Record<Tier, { label: string; color: string }> = {
  platform:   { label: 'Platform',   color: 'bg-indigo-500 text-white' },
  newsletter: { label: 'Newsletter', color: 'bg-teal-500 text-white' },
  free:       { label: 'Free',       color: 'bg-gray-500 text-white' },
}

export default function Layout() {
  const { user, isAdmin, tier, signOut } = useAuth()

  const isPlatform = tier === 'platform'

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 flex flex-col shrink-0" style={{ backgroundColor: '#1e1b4b' }}>

        {/* Brand */}
        <div className="px-4 py-4 border-b border-indigo-800">
          <div className="bg-white rounded-xl px-3 py-2 inline-flex items-center">
            <img src="/logo.png" alt="AcceleraQA" className="h-8 w-auto" />
          </div>
          <p className="text-indigo-300 text-xs mt-2 px-0.5">Regulatory Intelligence</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {/* News — all tiers */}
          <NavItem to="/news" icon={Newspaper} label="News" />

          {/* Platform only */}
          {isPlatform && (
            <NavItem to="/query" icon={MessageSquare} label="Intelligence Query" />
          )}

          {/* Admin content section */}
          {isAdmin && (
            <div className="pt-3 mt-3 border-t border-indigo-800">
              <p className="text-indigo-400 text-xs px-3 mb-1.5 uppercase tracking-wide font-medium">Content</p>
              <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
              <NavItem to="/documents" icon={FileText} label="Documents" />
              <p className="text-indigo-400 text-xs px-3 mt-3 mb-1.5 uppercase tracking-wide font-medium">Admin</p>
              <NavItem to="/admin/news" icon={ShieldCheck} label="News admin" />
              <NavItem to="/admin/users" icon={Users} label="Users" />
            </div>
          )}
        </nav>

        {/* User */}
        <div className="px-3 pb-4 border-t border-indigo-800 pt-3">
          <div className="px-3 py-2 mb-1">
            <p className="text-indigo-200 text-xs truncate">{user?.email}</p>
            <span className={`mt-1 inline-block text-xs font-medium px-2 py-0.5 rounded-full ${TIER_LABELS[tier].color}`}>
              {TIER_LABELS[tier].label}
            </span>
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

function NavItem({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          isActive ? 'text-white' : 'text-indigo-200 hover:text-white'
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
  )
}
