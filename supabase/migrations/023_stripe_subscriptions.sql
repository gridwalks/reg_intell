-- Stripe subscriptions. One row per user, written only by the stripe-webhook
-- Netlify function (service role). The webhook also keeps profiles.tier and
-- profiles.status in sync so existing tier/approval checks keep working.
create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text,                       -- trialing | active | past_due | canceled | unpaid | incomplete | incomplete_expired
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  trial_end timestamptz,
  updated_at timestamptz default now()
);

alter table public.subscriptions enable row level security;

-- Users may read their own subscription row (for showing status in the UI).
create policy "read own subscription"
  on public.subscriptions for select to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete policies for users. The service role bypasses RLS,
-- so only the webhook writes here.

-- ── Paid-tier gate ────────────────────────────────────────────────────────────
-- profiles.tier is the source of truth the rest of the app already keys off
-- of (PlatformRoute, the sidebar badge, NewsPage's client-side filter). The
-- webhook keeps it in sync with Stripe, so RLS checks it directly instead of
-- re-deriving access from the subscriptions table.
create or replace function public.has_paid_tier(uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and (tier in ('newsletter', 'platform') or is_admin)
  );
$$;

-- ── Enforce it on newsletter content ─────────────────────────────────────────
-- Previously "authenticated read all drafts" and the anon "public read
-- published drafts" policies used `using (true)` / `status = 'published'`
-- only — is_paid was enforced solely client-side in NewsPage, so any
-- authenticated (even pending/unapproved) or anonymous caller could already
-- read paid content directly via the API. Tighten both to match the UI.
drop policy if exists "authenticated read all drafts" on public.newsletter_drafts;
drop policy if exists "public read published drafts" on public.newsletter_drafts;

create policy "authenticated read drafts by tier"
  on public.newsletter_drafts for select to authenticated
  using (not is_paid or public.has_paid_tier(auth.uid()));

create policy "public read free published drafts"
  on public.newsletter_drafts for select to anon
  using (status = 'published' and not is_paid);
