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

  // Two entry points share this function:
  //  - No Authorization header: a brand-new visitor clicking "Create Account".
  //    No Supabase user exists yet — Stripe collects the email, and the
  //    webhook provisions the RegIntel account once payment succeeds.
  //  - Authorization header present: an existing (e.g. free-tier) user
  //    upgrading from their account page. Reuse/link their Stripe customer.
  const token = event.headers.authorization?.replace('Bearer ', '')
  let existingUser: { id: string; email?: string } | null = null

  if (token) {
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token)
    if (authErr || !user) return { statusCode: 401, headers, body: '{"error":"Unauthorized"}' }
    existingUser = user
  }

  if (!process.env.SITE_URL) {
    console.error('[create-checkout-session] SITE_URL is not set')
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured: SITE_URL is not set' }) }
  }

  try {
    let customerId: string | undefined
    const siteUrl = process.env.SITE_URL

    if (existingUser) {
      const { data: existing } = await adminClient
        .from('subscriptions')
        .select('stripe_customer_id')
        .eq('user_id', existingUser.id)
        .maybeSingle()

      customerId = existing?.stripe_customer_id as string | undefined
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: existingUser.email,
          metadata: { supabase_uid: existingUser.id },
        })
        customerId = customer.id
        // Seed the row so the customer id is linked before any webhook lands.
        await adminClient.from('subscriptions')
          .upsert({ user_id: existingUser.id, stripe_customer_id: customerId })
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId, // undefined for anonymous checkout — Stripe collects the email itself
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      subscription_data: {
        trial_period_days: 5,
        metadata: existingUser ? { supabase_uid: existingUser.id } : {},
      },
      success_url: existingUser
        ? `${siteUrl}/account?checkout=success`
        : `${siteUrl}/auth?checkout=success`,
      cancel_url: existingUser
        ? `${siteUrl}/account?checkout=cancelled`
        : `${siteUrl}/auth?checkout=cancelled`,
    })

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) }
  } catch (err) {
    console.error('[create-checkout-session] error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: (err as Error).message }) }
  }
}
