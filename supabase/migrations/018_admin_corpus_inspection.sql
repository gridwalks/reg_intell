-- Admin read all documents (for corpus inspection tool)
create policy "admins read all documents"
  on public.documents for select
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- Admin read all document_chunks
create policy "admins read all document_chunks"
  on public.document_chunks for select
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- Admin similarity search across all documents (no user_id filter)
create or replace function public.admin_match_document_chunks(
  query_embedding vector(1536),
  match_count     int default 10
)
returns table (
  id            uuid,
  document_id   uuid,
  document_name text,
  chunk_index   int,
  content       text,
  similarity    float,
  page_hint     text
)
language sql stable
as $$
  select
    dc.id,
    dc.document_id,
    d.name as document_name,
    dc.chunk_index,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity,
    dc.page_hint
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;
