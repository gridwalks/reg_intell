import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { startCheckout } from '../lib/stripe'
import { Shield, AlertCircle, CreditCard } from 'lucide-react'

export default function AuthPage() {
  const [params] = useSearchParams()
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState(() => {
    const checkout = params.get('checkout')
    if (checkout === 'success') return 'Payment successful — check your email for a link to set your password and get started.'
    if (checkout === 'cancelled') return 'Checkout cancelled — no charge was made.'
    return ''
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    try {
      if (mode === 'signup') {
        // No RegIntel account exists yet — Stripe collects the email and
        // payment, and the webhook creates the account once payment
        // succeeds, emailing a link to set a password.
        window.location.href = await startCheckout()
        return
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: 'https://regintel.acceleraqa.io/auth',
        })
        if (error) throw error
        setInfo('Password reset link sent — check your email.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)' }}>
      <div className="w-full max-w-md">

        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center bg-white rounded-2xl px-6 py-4 mb-4 shadow-lg">
            <img src="/logo.png" alt="AcceleraQA" className="h-12 w-auto" />
          </div>
          <p className="text-indigo-200 mt-2 text-sm">Regulatory Intelligence Platform</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">

          {mode !== 'reset' && (
            <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
              <button
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                  mode === 'login' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => { setMode('login'); setError(''); setInfo('') }}
              >
                Sign In
              </button>
              <button
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                  mode === 'signup' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => { setMode('signup'); setError(''); setInfo('') }}
              >
                Create Account
              </button>
            </div>
          )}

          {mode === 'reset' && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Reset password</h2>
              <p className="text-sm text-gray-500 mt-1">Enter your email and we'll send a reset link.</p>
            </div>
          )}

          {mode === 'signup' && (
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Start your free trial</h2>
              <p className="text-sm text-gray-500 mt-1">
                5 days free, then billed monthly. You'll enter your email and payment details with
                Stripe on the next step — your RegIntel account is created automatically once that's done.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode !== 'signup' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@company.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                />
              </div>
            )}

            {mode === 'login' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                />
              </div>
            )}

            {mode === 'signup' && (
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={e => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
                />
                <span className="text-sm text-gray-600">
                  I agree to the{' '}
                  <a href="https://acceleraqa.io/terms-of-use" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Terms of Use</a>
                  {' '}and{' '}
                  <a href="https://acceleraqa.io/privacy" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Privacy Policy</a>.
                </span>
              </label>
            )}

            {error && (
              <div className="flex items-start gap-2 text-red-600 bg-red-50 rounded-lg p-3 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            {info && (
              <div className="text-indigo-700 bg-indigo-50 rounded-lg p-3 text-sm">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (mode === 'signup' && !agreedToTerms)}
              className="w-full py-2.5 text-white font-medium rounded-lg transition-opacity text-sm disabled:opacity-60 flex items-center justify-center gap-2"
              style={{ backgroundColor: '#4F46E5' }}
            >
              {mode === 'signup' && !loading && <CreditCard className="w-4 h-4" />}
              {loading
                ? 'Please wait…'
                : mode === 'login' ? 'Sign In'
                : mode === 'signup' ? 'Continue to payment'
                : 'Send reset link'}
            </button>

            {mode === 'login' && (
              <button
                type="button"
                onClick={() => { setMode('reset'); setError(''); setInfo('') }}
                className="w-full text-sm text-gray-500 hover:text-indigo-600 text-center transition-colors"
              >
                Forgot password?
              </button>
            )}

            {mode === 'reset' && (
              <button
                type="button"
                onClick={() => { setMode('login'); setError(''); setInfo('') }}
                className="w-full text-sm text-gray-500 hover:text-indigo-600 text-center transition-colors"
              >
                Back to sign in
              </button>
            )}
          </form>

          <div className="mt-6 flex items-center gap-2 text-xs text-gray-400">
            <Shield className="w-4 h-4 shrink-0" />
            <span>Secured by Supabase. Your documents are private to your account.</span>
          </div>
        </div>
      </div>
    </div>
  )
}
