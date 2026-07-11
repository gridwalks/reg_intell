import { supabase } from './supabase'

async function callBillingFunction(
  name: 'create-checkout-session' | 'create-portal-session',
  requireAuth: boolean,
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (requireAuth && !session) throw new Error('Not signed in')

  const res = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? 'Request failed')
  return body.url as string
}

// Works both for a brand-new visitor (no session — Stripe collects the
// email and the webhook provisions the account) and a logged-in user
// upgrading their existing account.
export const startCheckout = () => callBillingFunction('create-checkout-session', false)

// Managing billing always requires knowing which account it's for.
export const openBillingPortal = () => callBillingFunction('create-portal-session', true)
