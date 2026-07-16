import type React from 'react'
import { useState, useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  FileText,
  MessageSquare,
  LogOut,
  ChevronRight,
  Newspaper,
  ExternalLink,
  Users,
  Database,
  CreditCard,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

const SUBSTACK_URL = 'https://acceleraqa.substack.com/'
import { useAuth, type Tier } from '../contexts/AuthContext'

const TIER_LABELS: Record<Tier, { label: string; color: string }> = {
  platform:   { label: 'Platform',   color: 'bg-indigo-500 text-white' },
  newsletter: { label: 'Newsletter', color: 'bg-teal-500 text-white' },
  free:       { label: 'Free',       color: 'bg-gray-500 text-white' },
}

export default function Layout() {
  const { user, isAdmin, tier, signOut } = useAuth()
  const isPlatform = tier === 'platform'

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem('sidebar-collapsed', String(collapsed)) } catch { /* ignore */ }
  }, [collapsed])

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside
        className="flex flex-col shrink-0 transition-all duration-200"
        style={{ backgroundColor: '#1e1b4b', width: collapsed ? '64px' : '240px' }}
      >
        {/* Brand + toggle */}
        <div className="flex items-center border-b border-indigo-800" style={{ minHeight: '64px', padding: collapsed ? '0 12px' : '0 16px' }}>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="bg-white rounded-xl px-3 py-2 inline-flex items-center">
                <img src="/logo.png" alt="AcceleraQA" className="h-8 w-auto" />
              </div>
              <p className="text-indigo-300 text-xs mt-1.5 px-0.5">Regulatory Intelligence</p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="shrink-0 p-1.5 rounded-lg text-indigo-300 hover:text-white hover:bg-indigo-800 transition-colors"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{ marginLeft: collapsed ? 0 : '8px' }}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto overflow-x-hidden">
          <NavItem to={SUBSTACK_URL} icon={Newspaper} label="News" external collapsed={collapsed} badge={<ExternalLink className="w-3 h-3 opacity-60" />} />

          {isPlatform && (
            <NavItem to="/query" icon={MessageSquare} label="Intelligence Query" collapsed={collapsed} />
          )}

          <NavItem to="/account" icon={CreditCard} label="Billing" collapsed={collapsed} />

          {isAdmin && (
            <div className={`pt-3 mt-3 border-t border-indigo-800 space-y-1 ${collapsed ? '' : ''}`}>
              {!collapsed && (
                <p className="text-indigo-400 text-xs px-3 mb-1.5 uppercase tracking-wide font-medium">Content</p>
              )}
              <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" collapsed={collapsed} />
              <NavItem to="/documents" icon={FileText} label="Documents" collapsed={collapsed} />
              {!collapsed && (
                <p className="text-indigo-400 text-xs px-3 mt-3 mb-1.5 uppercase tracking-wide font-medium">Admin</p>
              )}
              {collapsed && <div className="border-t border-indigo-800 my-1" />}
              <NavItem to="/admin/users"  icon={Users}    label="Users"             collapsed={collapsed} />
              <NavItem to="/admin/corpus" icon={Database} label="Corpus inspector"  collapsed={collapsed} />
            </div>
          )}
        </nav>

        {/* User footer */}
        <div className="px-2 pb-4 border-t border-indigo-800 pt-3">
          {!collapsed && (
            <div className="px-3 py-2 mb-1">
              <p className="text-indigo-200 text-xs truncate">{user?.email}</p>
              <span className={`mt-1 inline-block text-xs font-medium px-2 py-0.5 rounded-full ${TIER_LABELS[tier].color}`}>
                {TIER_LABELS[tier].label}
              </span>
            </div>
          )}
          <button
            onClick={signOut}
            title="Sign Out"
            className={`flex items-center gap-3 w-full px-3 py-2.5 text-indigo-300 hover:text-white rounded-lg text-sm font-medium transition-colors hover:bg-indigo-800 ${collapsed ? 'justify-center' : ''}`}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!collapsed && 'Sign Out'}
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

type NavItemProps = {
  to: string
  icon: React.ElementType
  label: string
  collapsed: boolean
  external?: boolean
  badge?: React.ReactNode
}

function NavItem({ to, icon: Icon, label, collapsed, external = false, badge }: NavItemProps) {
  const baseClass = `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${collapsed ? 'justify-center' : ''}`

  if (external) {
    return (
      <a
        href={to}
        target="_blank"
        rel="noopener noreferrer"
        title={collapsed ? label : undefined}
        className={`${baseClass} text-indigo-200 hover:text-white`}
      >
        <Icon className="w-4 h-4 shrink-0" />
        {!collapsed && <><span className="flex-1">{label}</span>{badge}</>}
      </a>
    )
  }

  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `${baseClass} ${isActive ? 'text-white' : 'text-indigo-200 hover:text-white'}`
      }
      style={({ isActive }) => isActive ? { backgroundColor: '#4F46E5' } : undefined}
    >
      {({ isActive }) => (
        <>
          <Icon className="w-4 h-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1">{label}</span>
              {isActive && <ChevronRight className="w-3 h-3 opacity-60" />}
            </>
          )}
        </>
      )}
    </NavLink>
  )
}
