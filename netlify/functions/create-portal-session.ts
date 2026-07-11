import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

function getSupabaseUrl(): string {
  const dbUrl = process.env.SUPABASE_DATABASE_URL ?? ''
  const match = dbUrl.match(/postgres\.([^:@]+)[^@]*@/)
  if (match) return `https://${match[1]}.supabase.co`
  return process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
}

const authClient = createClient(
  getSupabaseUrl(),
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
)
const adminClient = createClient(getSupabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY!)

// TODO: pin apiVersion once deployed — see create-checkout-session.ts.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' }

  const token = event.headers.authorization?.replace('Bearer ', '')
  if (!token) return { statusCode: 401, headers, body: '{"error":"Unauthorized"}' }

  const { data: { user }, error: authErr } = await authClient.auth.getUser(token)
  if (authErr || !user) return { statusCode: 401, headers, body: '{"error":"Unauthorized"}' }

  try {
    const { data: sub } = await adminClient
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!sub?.stripe_customer_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No Stripe customer on file yet' }) }
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${process.env.SITE_URL}/account`,
    })

    return { statusCode: 200, headers, body: JSON.stringify({ url: portal.url }) }
  } catch (err) {
    console.error('[create-portal-session] error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: (err as Error).message }) }
  }
}
