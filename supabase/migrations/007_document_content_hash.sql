alter table public.documents add column if not exists content_hash text;

create unique index if not exists documents_user_content_hash_idx
  on public.documents (user_id, content_hash)
  where content_hash is not null;
