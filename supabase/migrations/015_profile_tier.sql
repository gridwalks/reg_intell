alter table public.profiles
  add column if not exists tier text not null default 'platform'
  check (tier in ('platform', 'newsletter', 'free'));
