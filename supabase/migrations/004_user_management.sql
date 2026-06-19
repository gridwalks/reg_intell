-- ── Profiles ──────────────────────────────────────────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected')),
  is_admin    boolean not null default false,
  approved_at timestamptz,
  created_at  timestamptz default now()
);

-- Auto-create a pending profile whenever a new user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: existing users are approved so they are not locked out
insert into public.profiles (id, email, status, approved_at)
select id, email, 'approved', now()
from auth.users
on conflict (id) do nothing;

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

-- Any authenticated user can read their own profile (needed to check status)
create policy "users read own profile"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

-- Admins can read all profiles
create policy "admins read all profiles"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

-- Writes go through the manage-user Netlify function (service role only)

-- ── Bootstrap note ────────────────────────────────────────────────────────────
-- After running this migration, make yourself admin by running in the SQL editor:
--   update public.profiles set is_admin = true where email = 'your@email.com';
