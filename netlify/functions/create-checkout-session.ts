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

// TODO: pin apiVersion once deployed, e.g. { apiVersion: '2025-xx-xx.basil' } —
// copy the exact string from Stripe dashboard > Developers > API keys, so a
// future account default can't reshape payloads under us.
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
    // Reuse an existing Stripe customer id if we have one.
    const { data: existing } = await adminClient
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle()

    let customerId = existing?.stripe_customer_id as string | undefined
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_uid: user.id },
      })
      customerId = customer.id
      // Seed the row so the customer id is linked before any webhook lands.
      await adminClient.from('subscriptions')
        .upsert({ user_id: user.id, stripe_customer_id: customerId })
    }

    const siteUrl = process.env.SITE_URL!
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      subscription_data: {
        trial_period_days: 5,
        metadata: { supabase_uid: user.id },
      },
      success_url: `${siteUrl}/account?checkout=success`,
      cancel_url: `${siteUrl}/account?checkout=cancelled`,
    })

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) }
  } catch (err) {
    console.error('[create-checkout-session] error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: (err as Error).message }) }
  }
}
