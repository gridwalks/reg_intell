import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

function getSupabaseUrl(): string {
  const dbUrl = process.env.SUPABASE_DATABASE_URL ?? ''
  const match = dbUrl.match(/postgres\.([^:@]+)[^@]*@/)
  if (match) return `https://${match[1]}.supabase.co`
  return process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
}

const admin = createClient(getSupabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY!)

// TODO: pin apiVersion once deployed — see create-checkout-session.ts.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

// Statuses that count as "has access" — kept in one place so profiles.tier
// and the webhook logic below can't drift out of sync with each other.
const ACTIVE_STATUSES = new Set(['trialing', 'active'])

export const handler: Handler = async (event) => {
  const signature = event.headers['stripe-signature']
  if (!signature) return { statusCode: 400, body: 'Missing stripe-signature header' }

  // Netlify may deliver the raw body base64-encoded; Stripe's signature check
  // needs the exact bytes Stripe sent, so decode before verifying — never
  // JSON.parse first.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : event.body ?? ''

  let stripeEvent: Stripe.Event
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    )
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err)
    return { statusCode: 400, body: `Webhook signature failed: ${(err as Error).message}` }
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        // For an anonymous checkout (new-signup flow) this is the first
        // event to arrive, and the only one carrying the email Stripe just
        // collected — pass it through so a brand-new account can be
        // provisioned right here rather than waiting on subscription events.
        const s = stripeEvent.data.object as Stripe.Checkout.Session
        if (!s.customer) break
        const uid = await getOrCreateUid(s.customer as string, s.customer_details?.email ?? s.customer_email)
        if (uid) {
          await admin.from('subscriptions')
            .upsert({ user_id: uid, stripe_customer_id: s.customer as string })
        }
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object as Stripe.Subscription
        const uid = await getOrCreateUid(sub.customer as string, null)
        if (!uid) break

        // As of Stripe's newer API versions, current_period_end moved off the
        // subscription object onto each subscription item.
        const item = sub.items.data[0]

        await admin.from('subscriptions').upsert({
          user_id: uid,
          stripe_customer_id: sub.customer as string,
          stripe_subscription_id: sub.id,
          status: sub.status,
          price_id: item?.price.id,
          current_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : null,
          cancel_at_period_end: sub.cancel_at_period_end,
          trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          updated_at: new Date().toISOString(),
        })

        // Keep profiles.tier/status in sync — that's what PlatformRoute,
        // NewsPage, and the sidebar badge already key off of. Paying grants
        // 'platform' and auto-approves; losing access drops back to 'free'
        // (status is left alone once approved, so a lapsed subscriber keeps
        // logging in — they just lose the paid tier).
        if (ACTIVE_STATUSES.has(sub.status)) {
          await admin.from('profiles')
            .update({ tier: 'platform', status: 'approved', approved_at: new Date().toISOString() })
            .eq('id', uid)
        } else {
          await admin.from('profiles')
            .update({ tier: 'free' })
            .eq('id', uid)
            .eq('tier', 'platform') // don't clobber a tier an admin set manually
        }
        break
      }

      case 'invoice.payment_failed': {
        // No-op: customer.subscription.updated also fires and moves status
        // to past_due, which ACTIVE_STATUSES already excludes.
        break
      }

      case 'customer.subscription.trial_will_end': {
        // Fires ~3 days before trial end. Hook a reminder email here if wanted.
        break
      }
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err)
    return { statusCode: 500, body: 'Handler error' }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) }
}

// Map a Stripe customer id to a Supabase user id, provisioning the RegIntel
// account on first contact if one doesn't exist yet. Covers three cases:
//  1. Already linked (subscriptions row, or the customer was tagged earlier
//     in this same flow / by an authenticated upgrade checkout).
//  2. An account with this email already exists (e.g. an admin-created user
//     subscribing for the first time) — link it instead of duplicating.
//  3. Brand-new customer from the anonymous checkout flow — create the
//     account and email them a link to set a password.
async function getOrCreateUid(customerId: string, emailHint?: string | null): Promise<string | null> {
  const { data: linked } = await admin.from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  if (linked?.user_id) return linked.user_id

  const customerResponse = await stripe.customers.retrieve(customerId)
  if (customerResponse.deleted) return null
  const customer = customerResponse as Stripe.Customer

  if (customer.metadata?.supabase_uid) return customer.metadata.supabase_uid

  const email = emailHint ?? customer.email
  if (!email) return null

  const { data: existingProfile } = await admin.from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  let uid = existingProfile?.id as string | undefined

  if (!uid) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.SITE_URL}/auth`,
    })
    if (data?.user) {
      uid = data.user.id
    } else if (error?.message?.toLowerCase().includes('already been registered')) {
      // Lost a race with a concurrent webhook delivery creating the same
      // user (checkout.session.completed and customer.subscription.created
      // can arrive close together) — reuse what it created.
      const { data: retry } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
      uid = retry?.id
    } else {
      console.error('[stripe-webhook] inviteUserByEmail failed:', error)
      return null
    }
  }

  if (!uid) return null

  // Tag the customer so future events resolve without touching profiles/auth again.
  await stripe.customers.update(customerId, { metadata: { supabase_uid: uid } })
  return uid
}
