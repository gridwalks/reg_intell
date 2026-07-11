import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ClockIcon, LogOut, Loader2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { startCheckout } from '../lib/stripe'

const POLL_ATTEMPTS = 8
const POLL_INTERVAL_MS = 1500

export default function PendingApprovalPage({ rejected = false }: { rejected?: boolean }) {
  const { user, signOut, reloadProfile } = useAuth()
  const [params] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [finalizing, setFinalizing] = useState(params.get('checkout') === 'success')

  // Just back from Stripe — the webhook auto-approves paying users, but it
  // usually takes a second or two to land, so poll briefly instead of
  // leaving them stuck on this screen.
  useEffect(() => {
    if (!finalizing) return
    let attempts = 0
    const interval = setInterval(async () => {
      attempts += 1
      await reloadProfile()
      if (attempts >= POLL_ATTEMPTS) {
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

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="max-w-md w-full mx-4 text-center">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 ${
            rejected ? 'bg-red-100' : 'bg-amber-100'
          }`}>
            <ClockIcon className={`w-8 h-8 ${rejected ? 'text-red-500' : 'text-amber-500'}`} />
          </div>

          {rejected ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900 mb-2">Access not approved</h1>
              <p className="text-gray-500 text-sm leading-relaxed">
                Your account request for <span className="font-medium text-gray-700">{user?.email}</span> was
                not approved. Please contact your administrator for more information.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-gray-900 mb-2">Awaiting approval</h1>
              <p className="text-gray-500 text-sm leading-relaxed">
                Your account <span className="font-medium text-gray-700">{user?.email}</span> has been
                created and is pending approval by an administrator. Subscribe now to get instant access.
              </p>

              {finalizing && (
                <div className="flex items-center justify-center gap-2 text-sm text-indigo-600 mt-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Finalizing your subscription…
                </div>
              )}
              {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

              <button
                onClick={handleSubscribe}
                disabled={busy}
                className="mt-6 w-full py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: '#4F46E5' }}
              >
                Subscribe
              </button>
            </>
          )}

          <button
            onClick={signOut}
            className="mt-6 flex items-center gap-2 mx-auto text-sm text-gray-500 hover:text-gray-700"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
