-- Generic admin-writable key/value settings. First use: which model the
-- chat function uses, previously a client-controlled field on every request.
create table public.app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);

alter table public.app_settings enable row level security;

-- Any authenticated user can read settings (needed to show the current
-- model on the admin dashboard) — chat.ts itself reads via the service
-- role and bypasses RLS regardless.
create policy "authenticated read settings"
  on public.app_settings for select to authenticated using (true);

-- Only admins can write. Mirrors the "admins can update newsletter_drafts"
-- pattern from migration 013.
create policy "admins write settings"
  on public.app_settings for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

insert into public.app_settings (key, value)
values ('chat_model', 'command-a-plus-05-2026')
on conflict (key) do nothing;
