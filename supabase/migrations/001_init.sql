-- Enable pgvector
create extension if not exists vector;

-- ============================================================
-- Documents table
-- ============================================================
create table public.documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  name        text not null,
  file_path   text not null,        -- Supabase Storage path
  file_size   bigint,
  file_type   text,                  -- application/pdf, etc.
  status      text not null default 'processing', -- processing | ready | error
  chunk_count int default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.documents enable row level security;

create policy "Users manage own documents"
  on public.documents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Document chunks table (the RAG store)
-- ============================================================
create table public.document_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id) on delete cascade not null,
  content     text not null,
  embedding   vector(1536),   -- OpenAI text-embedding-3-small
  chunk_index int not null,
  page_hint   text,           -- optional: page number or section heading
  created_at  timestamptz default now()
);

alter table public.document_chunks enable row level security;

-- Chunks are readable only through their parent document (join-check)
create policy "Users read chunks of own documents"
  on public.document_chunks for select
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id
        and d.user_id = auth.uid()
    )
  );

-- Index for fast ANN search
create index on public.document_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ============================================================
-- Similarity search function (called from Netlify Functions)
-- ============================================================
create or replace function public.match_document_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count     int,
  p_user_id       uuid
)
returns table (
  id          uuid,
  document_id uuid,
  content     text,
  similarity  float,
  doc_name    text
)
language sql stable
as $$
  select
    dc.id,
    dc.document_id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity,
    d.name as doc_name
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where d.user_id = p_user_id
    and d.status = 'ready'
    and 1 - (dc.embedding <=> query_embedding) > match_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- Storage bucket
-- ============================================================
insert into storage.buckets (id, name, public)
values ('regulatory-documents', 'regulatory-documents', false)
on conflict do nothing;

-- Users can upload / read / delete their own files
create policy "User uploads"
  on storage.objects for insert
  with check (
    bucket_id = 'regulatory-documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "User reads own files"
  on storage.objects for select
  using (
    bucket_id = 'regulatory-documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "User deletes own files"
  on storage.objects for delete
  using (
    bucket_id = 'regulatory-documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- Trigger: keep updated_at current
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at
  before update on public.documents
  for each row execute function public.handle_updated_at();
