import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type Tier = 'platform' | 'newsletter' | 'free'

export type Profile = {
  id: string
  email: string
  full_name: string | null
  status: 'pending' | 'approved' | 'rejected'
  is_admin: boolean
  tier: Tier
  approved_at: string | null
  created_at: string
}

type AuthContextType = {
  user: User | null
  session: Session | null
  profile: Profile | null
  isAdmin: boolean
  tier: Tier
  loading: boolean
  needsPasswordReset: boolean
  signOut: () => Promise<void>
  reloadProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  isAdmin: false,
  tier: 'platform',
  loading: true,
  needsPasswordReset: false,
  signOut: async () => {},
  reloadProfile: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsPasswordReset, setNeedsPasswordReset] = useState(false)

  const fetchProfile = async (userId: string) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      setProfile(data ?? null)
    } catch {
      // profiles table may not exist yet — treat as no profile
      setProfile(null)
    }
  }

  const reloadProfile = async () => {
    if (user) await fetchProfile(user.id)
  }

  useEffect(() => {
    // Initialise from existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Keep auth state in sync — must stay synchronous
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (!session?.user) setProfile(null)
      if (event === 'PASSWORD_RECOVERY') setNeedsPasswordReset(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Load profile whenever user changes
  useEffect(() => {
    if (user) fetchProfile(user.id)
  }, [user?.id])

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      isAdmin: profile?.is_admin ?? false,
      tier: profile?.tier ?? 'platform',
      loading,
      needsPasswordReset,
      signOut,
      reloadProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
