import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CreditCard, Loader2, ShieldCheck, BarChart2 } from 'lucide-react'
import { supabase, type Subscription } from '../lib/supabase'
import { startCheckout, openBillingPortal } from '../lib/stripe'
import { useAuth } from '../contexts/AuthContext'

const ACTIVE_STATUSES = new Set(['trialing', 'active'])
const POLL_ATTEMPTS = 8
const POLL_INTERVAL_MS = 1500

export default function AccountPage() {
  const { user, tier, reloadProfile } = useAuth()
  const [params] = useSearchParams()
  const [sub, setSub] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [finalizing, setFinalizing] = useState(params.get('checkout') === 'success')
  const [usageData, setUsageData] = useState<{ used: number; limit: number | null } | null>(null)

  const fetchSubscription = async () => {
    if (!user) return
    const { data } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
    setSub(data)
    return data
  }

  useEffect(() => {
    fetchSubscription().finally(() => setLoading(false))
    if (user) {
      Promise.all([
        supabase.rpc('usage_this_month', { p_user_id: user.id }),
        supabase.from('profiles').select('tier, monthly_query_limit').eq('id', user.id).single(),
      ]).then(([usageRes, profileRes]) => {
        const used = (usageRes.data as number) ?? 0
        const tierName = (profileRes.data?.tier ?? 'free') as string
        const tierLimits: Record<string, number | null> = { platform: 200, newsletter: 20, free: 5 }
        const limit: number | null = profileRes.data?.monthly_query_limit ?? tierLimits[tierName] ?? 5
        setUsageData({ used, limit })
      })
    }
  }, [user?.id])

  // Just back from Stripe — the webhook usually lands within a second or two,
  // so poll briefly rather than showing stale "no subscription" state.
  useEffect(() => {
    if (!finalizing) return
    let attempts = 0
    const interval = setInterval(async () => {
      attempts += 1
      await reloadProfile()
      const data = await fetchSubscription()
      if ((data && ACTIVE_STATUSES.has(data.status ?? '')) || attempts >= POLL_ATTEMPTS) {
        setFinalizing(false)
        clearInterval(interval)
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [finalizing])

  const handleSubscribe = async () => {
    setError('')
    setBusy(true)
    try {
      window.location.href = await startCheckout()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout')
      setBusy(false)
    }
  }

  const handleManageBilling = async () => {
    setError('')
    setBusy(true)
    try {
      window.location.href = await openBillingPortal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open billing portal')
      setBusy(false)
    }
  }

  const hasActiveAccess = tier === 'platform'

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Billing</h1>

      {loading ? (
        <Spinner />
      ) : (
        <>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          {finalizing && (
            <div className="flex items-center gap-2 text-sm text-indigo-600 mb-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Finalizing your subscription…
            </div>
          )}

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

          <div className="flex items-center gap-3 mb-1">
            {hasActiveAccess ? (
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
            ) : (
              <CreditCard className="w-5 h-5 text-gray-400" />
            )}
            <span className="font-medium text-gray-900">
              {sub?.status ? formatStatus(sub.status) : 'No subscription'}
            </span>
          </div>

          {sub?.trial_end && sub.status === 'trialing' && (
            <p className="text-sm text-gray-500 mb-1">
              Trial ends {new Date(sub.trial_end).toLocaleDateString()}
            </p>
          )}
          {sub?.current_period_end && (
            <p className="text-sm text-gray-500 mb-1">
              {sub.cancel_at_period_end ? 'Access ends' : 'Renews'}{' '}
              {new Date(sub.current_period_end).toLocaleDateString()}
            </p>
          )}

          <div className="mt-6 flex gap-3">
            {sub?.stripe_customer_id && (
              <button
                onClick={handleManageBilling}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Manage billing
              </button>
            )}
            {!hasActiveAccess && (
              <button
                onClick={handleSubscribe}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: '#4F46E5' }}
              >
                Subscribe
              </button>
            )}
          </div>
        </div>

        {/* Usage meter */}
        {usageData && (
          <div className="mt-6 bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <BarChart2 className="w-5 h-5 text-indigo-500" />
              <h2 className="font-medium text-gray-900">Query Usage — This Month</h2>
            </div>
            {usageData.limit === null ? (
              <p className="text-sm text-gray-500">{usageData.used} queries used &mdash; unlimited plan</p>
            ) : (
              <>
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span>{usageData.used} of {usageData.limit} queries used</span>
                  <span className={usageData.used / usageData.limit >= 0.9 ? 'text-red-600 font-medium' : 'text-gray-400'}>
                    {usageData.limit - usageData.used} remaining
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      usageData.used / usageData.limit >= 0.9
                        ? 'bg-red-500'
                        : usageData.used / usageData.limit >= 0.7
                        ? 'bg-amber-500'
                        : 'bg-indigo-500'
                    }`}
                    style={{ width: `${Math.min(100, (usageData.used / usageData.limit) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2">Resets on the 1st of each month</p>
              </>
            )}
          </div>
        )}
        </>
      )}
    </div>
  )
}

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
