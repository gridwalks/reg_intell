alter table public.newsletter_drafts add column if not exists is_paid boolean not null default false;
