-- Newsletter chunks for RAG search
create table public.newsletter_chunks (
  id                   uuid primary key default gen_random_uuid(),
  newsletter_draft_id  uuid references public.newsletter_drafts(id) on delete cascade not null,
  content              text not null,
  embedding            vector(1536),
  chunk_index          int not null,
  draft_date           date,
  created_at           timestamptz default now()
);

alter table public.newsletter_chunks enable row level security;

-- Newsletters are shared content — all authenticated users can search them
create policy "authenticated read newsletter chunks"
  on public.newsletter_chunks for select to authenticated using (true);

create index on public.newsletter_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- Similarity search function (no user filter — newsletters are global)
create or replace function public.match_newsletter_chunks(
  query_embedding  vector(1536),
  match_threshold  float,
  match_count      int
)
returns table (
  id                   uuid,
  newsletter_draft_id  uuid,
  content              text,
  similarity           float,
  draft_date           date
)
language sql stable as $$
  select
    nc.id,
    nc.newsletter_draft_id,
    nc.content,
    1 - (nc.embedding <=> query_embedding) as similarity,
    nc.draft_date
  from public.newsletter_chunks nc
  where 1 - (nc.embedding <=> query_embedding) > match_threshold
  order by nc.embedding <=> query_embedding
  limit match_count;
$$;
