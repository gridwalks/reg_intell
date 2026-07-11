import { supabase } from './supabase'

async function callBillingFunction(name: 'create-checkout-session' | 'create-portal-session'): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? 'Request failed')
  return body.url as string
}

export const startCheckout = () => callBillingFunction('create-checkout-session')
export const openBillingPortal = () => callBillingFunction('create-portal-session')
