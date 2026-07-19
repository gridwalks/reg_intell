-- ── Usage events ──────────────────────────────────────────────────────────────
create table public.usage_events (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_type  text not null default 'chat_query',
  created_at  timestamptz not null default now()
);

create index usage_events_user_month_idx
  on public.usage_events (user_id, created_at);

alter table public.usage_events enable row level security;

-- Users can only read their own events
create policy "users read own usage"
  on public.usage_events for select to authenticated
  using (auth.uid() = user_id);

-- Inserts go through service role (Netlify function) only

-- ── Per-user limit override on profiles ───────────────────────────────────────
-- NULL means "use the tier default"
alter table public.profiles
  add column if not exists monthly_query_limit integer;

-- ── Helper: queries used this calendar month ──────────────────────────────────
create or replace function public.usage_this_month(p_user_id uuid)
returns integer language sql stable security definer as $$
  select count(*)::integer
  from public.usage_events
  where user_id = p_user_id
    and event_type = 'chat_query'
    and date_trunc('month', created_at) = date_trunc('month', now());
$$;
